// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IQorePQC} from "./interfaces/IQorePQC.sol";

/// @title Seedproof Vault
/// @notice Savings that a stolen seed phrase cannot reach.
///
/// Every action that moves value or changes rules needs a signature from the
/// owner's Home Key: an ML-DSA-87 key that is NOT derived from the seed phrase,
/// verified on chain by QoreChain's pqcVerify precompile. `msg.sender` grants
/// nothing, so whoever submits the transaction (phone, relayer, thief) does not
/// matter.
///
/// - Top-ups to the pocket are instant but capped per token per UTC day.
/// - Withdrawals and rule changes wait `delay` seconds and can be cancelled by
///   any guardian or by the Home Key during that time.
/// - Guardians can freeze and cancel. They can never move funds or unfreeze.
contract SeedproofVault {
    IQorePQC public constant PQC = IQorePQC(0x0000000000000000000000000000000000000a01);
    bytes32 public constant DOMAIN = keccak256("seedproof.vault.v1");
    address public constant NATIVE = address(0);
    uint256 public constant ML_DSA_87_PUBKEY_LENGTH = 2592;
    uint256 public constant ML_DSA_87_SIG_LENGTH = 4627;
    uint64 public constant MIN_DELAY = 1 hours;
    uint64 public constant MAX_DELAY = 30 days;
    uint256 public constant MAX_GUARDIANS = 8;

    enum Action {
        TopUp, //          payload: (address token, address to, uint256 amount)
        Withdraw, //       payload: (address token, address to, uint256 amount)
        Cancel, //         payload: (uint256 id)
        Unfreeze, //       payload: ()
        SetGuardian, //    payload: (address guardian, bool enabled)
        SetDailyLimit, //  payload: (address token, uint256 limit)
        SetDelay, //       payload: (uint64 delay)
        RotateHomeKey //   payload: (bytes32 newHomeKeyHash)
    }

    enum Status {
        None,
        Pending,
        Executed,
        Cancelled
    }

    struct Queued {
        Action action;
        Status status;
        uint64 readyAt;
        bytes payload;
    }

    /// keccak256 of the Home Key's 2,592-byte ML-DSA-87 public key.
    bytes32 public homeKeyHash;
    uint64 public delay;
    /// Next nonce the Home Key must sign. Every signed action consumes one.
    uint256 public nonce;
    bool public frozen;
    uint256 public guardianCount;
    mapping(address => bool) public isGuardian;
    mapping(address token => uint256) public dailyLimit;
    mapping(address token => mapping(uint256 day => uint256)) public spentOnDay;
    Queued[] internal _queue;

    uint256 private _lock = 1;

    event Deposited(address indexed token, address indexed from, uint256 amount);
    event ToppedUp(address indexed token, address indexed to, uint256 amount, uint256 nonce);
    event Queued_(uint256 indexed id, Action action, uint64 readyAt, bytes payload, uint256 nonce);
    event Executed(uint256 indexed id, Action action);
    event Cancelled(uint256 indexed id, address indexed by);
    event Frozen(address indexed guardian);
    event Unfrozen(uint256 nonce);

    error Expired();
    error WrongHomeKey();
    error BadLength();
    error BadSignature();
    error IsFrozen();
    error NotGuardian();
    error OverDailyLimit(uint256 available);
    error NotReady(uint64 readyAt);
    error NotPending();
    error BadDelay();
    error BadGuardian();
    error TooManyGuardians();
    error TransferFailed();
    error Reentrancy();
    error UnknownAction();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(bytes32 homeKeyHash_, uint64 delay_, address[] memory guardians_) {
        if (homeKeyHash_ == bytes32(0)) revert WrongHomeKey();
        _setDelay(delay_);
        homeKeyHash = homeKeyHash_;
        for (uint256 i = 0; i < guardians_.length; i++) {
            _setGuardian(guardians_[i], true);
        }
    }

    // ---------------------------------------------------------------- deposits

    receive() external payable {
        emit Deposited(NATIVE, msg.sender, msg.value);
    }

    // ------------------------------------------------------- signed messages

    /// @notice The exact bytes the Home Key signs for an action.
    function signedMessage(Action action, bytes memory payload, uint256 nonce_, uint256 deadline)
        public
        view
        returns (bytes memory)
    {
        return abi.encode(DOMAIN, block.chainid, address(this), nonce_, uint8(action), payload, deadline);
    }

    function _verify(
        Action action,
        bytes memory payload,
        uint256 deadline,
        bytes calldata pubkey,
        bytes calldata signature
    ) internal {
        if (block.timestamp > deadline) revert Expired();
        if (pubkey.length != ML_DSA_87_PUBKEY_LENGTH || signature.length != ML_DSA_87_SIG_LENGTH) revert BadLength();
        if (keccak256(pubkey) != homeKeyHash) revert WrongHomeKey();
        uint256 n = nonce;
        // A typed call reverts on empty return data, so an inactive precompile fails closed.
        if (!PQC.pqcVerify(pubkey, signature, signedMessage(action, payload, n, deadline))) revert BadSignature();
        nonce = n + 1;
    }

    // ------------------------------------------------------------- top-ups

    /// @notice Instant transfer to the pocket, capped per token per UTC day.
    function topUp(
        address token,
        address to,
        uint256 amount,
        uint256 deadline,
        bytes calldata pubkey,
        bytes calldata signature
    ) external nonReentrant {
        if (frozen) revert IsFrozen();
        _verify(Action.TopUp, abi.encode(token, to, amount), deadline, pubkey, signature);
        uint256 day = block.timestamp / 1 days;
        uint256 spent = spentOnDay[token][day];
        uint256 limit = dailyLimit[token];
        if (spent + amount > limit) revert OverDailyLimit(limit > spent ? limit - spent : 0);
        spentOnDay[token][day] = spent + amount;
        emit ToppedUp(token, to, amount, nonce - 1);
        _transfer(token, to, amount);
    }

    // --------------------------------------------------------------- queue

    /// @notice Queue a delayed action signed by the Home Key. Anyone may submit it.
    function queue(Action action, bytes calldata payload, uint256 deadline, bytes calldata pubkey, bytes calldata signature)
        external
        returns (uint256 id)
    {
        if (
            action == Action.TopUp || action == Action.Cancel || action == Action.Unfreeze
        ) revert UnknownAction();
        _validatePayload(action, payload);
        _verify(action, payload, deadline, pubkey, signature);
        uint64 readyAt = uint64(block.timestamp) + delay;
        id = _queue.length;
        _queue.push(Queued({action: action, status: Status.Pending, readyAt: readyAt, payload: payload}));
        emit Queued_(id, action, readyAt, payload, nonce - 1);
    }

    /// @notice Run a queued action once its delay has passed. Anyone may call.
    function execute(uint256 id) external nonReentrant {
        if (frozen) revert IsFrozen();
        Queued storage q = _queue[id];
        if (q.status != Status.Pending) revert NotPending();
        if (block.timestamp < q.readyAt) revert NotReady(q.readyAt);
        q.status = Status.Executed;
        Action action = q.action;
        bytes memory p = q.payload;
        emit Executed(id, action);

        if (action == Action.Withdraw) {
            (address token, address to, uint256 amount) = abi.decode(p, (address, address, uint256));
            _transfer(token, to, amount);
        } else if (action == Action.SetGuardian) {
            (address g, bool enabled) = abi.decode(p, (address, bool));
            _setGuardian(g, enabled);
        } else if (action == Action.SetDailyLimit) {
            (address token, uint256 limit) = abi.decode(p, (address, uint256));
            dailyLimit[token] = limit;
        } else if (action == Action.SetDelay) {
            _setDelay(abi.decode(p, (uint64)));
        } else if (action == Action.RotateHomeKey) {
            bytes32 h = abi.decode(p, (bytes32));
            homeKeyHash = h;
        } else {
            revert UnknownAction();
        }
    }

    /// @notice Any guardian can cancel a pending action.
    function cancel(uint256 id) external {
        if (!isGuardian[msg.sender]) revert NotGuardian();
        _cancel(id, msg.sender);
    }

    /// @notice The Home Key can cancel a pending action too.
    function cancelWithHomeKey(uint256 id, uint256 deadline, bytes calldata pubkey, bytes calldata signature) external {
        _verify(Action.Cancel, abi.encode(id), deadline, pubkey, signature);
        _cancel(id, address(0));
    }

    function _cancel(uint256 id, address by) internal {
        Queued storage q = _queue[id];
        if (q.status != Status.Pending) revert NotPending();
        q.status = Status.Cancelled;
        emit Cancelled(id, by);
    }

    // -------------------------------------------------------------- freeze

    /// @notice Any guardian can freeze top-ups and executions. Only the Home Key can unfreeze.
    function freeze() external {
        if (!isGuardian[msg.sender]) revert NotGuardian();
        frozen = true;
        emit Frozen(msg.sender);
    }

    function unfreeze(uint256 deadline, bytes calldata pubkey, bytes calldata signature) external {
        _verify(Action.Unfreeze, "", deadline, pubkey, signature);
        frozen = false;
        emit Unfrozen(nonce - 1);
    }

    // --------------------------------------------------------------- views

    function queued(uint256 id) external view returns (Queued memory) {
        return _queue[id];
    }

    function queueLength() external view returns (uint256) {
        return _queue.length;
    }

    function availableToday(address token) external view returns (uint256) {
        uint256 spent = spentOnDay[token][block.timestamp / 1 days];
        uint256 limit = dailyLimit[token];
        return limit > spent ? limit - spent : 0;
    }

    // ------------------------------------------------------------ internals

    function _validatePayload(Action action, bytes calldata p) internal view {
        if (action == Action.Withdraw) {
            (, address to,) = abi.decode(p, (address, address, uint256));
            if (to == address(0)) revert TransferFailed();
        } else if (action == Action.SetGuardian) {
            (address g, bool enabled) = abi.decode(p, (address, bool));
            if (g == address(0)) revert BadGuardian();
            if (enabled && !isGuardian[g] && guardianCount >= MAX_GUARDIANS) revert TooManyGuardians();
        } else if (action == Action.SetDailyLimit) {
            abi.decode(p, (address, uint256));
        } else if (action == Action.SetDelay) {
            uint64 d = abi.decode(p, (uint64));
            if (d < MIN_DELAY || d > MAX_DELAY) revert BadDelay();
        } else if (action == Action.RotateHomeKey) {
            if (abi.decode(p, (bytes32)) == bytes32(0)) revert WrongHomeKey();
        }
    }

    function _setDelay(uint64 d) internal {
        if (d < MIN_DELAY || d > MAX_DELAY) revert BadDelay();
        delay = d;
    }

    function _setGuardian(address g, bool enabled) internal {
        if (g == address(0)) revert BadGuardian();
        if (isGuardian[g] == enabled) return;
        if (enabled) {
            if (guardianCount >= MAX_GUARDIANS) revert TooManyGuardians();
            guardianCount++;
        } else {
            guardianCount--;
        }
        isGuardian[g] = enabled;
    }

    function _transfer(address token, address to, uint256 amount) internal {
        if (to == address(0)) revert TransferFailed();
        if (token == NATIVE) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
            if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        }
    }
}
