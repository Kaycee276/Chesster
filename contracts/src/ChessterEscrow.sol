// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title ChessterEscrow
 * @dev Handles equal-stakes chess match wagering with backend-coordinated payouts.
 * Winner receives 95% of the pot, admin (coordinator) receives 5%.
 * Supports both native ETH and ERC20 token wagers.
 * Draw support and automatic refunds after 1 hour timeout.
 */
contract ChessterEscrow {
    address public coordinator;

    uint256 public constant WINNER_BPS = 9500; // 95%
    uint256 public constant ADMIN_BPS = 500;   // 5%
    uint256 public constant BPS_DENOMINATOR = 10000;

    // Use address(0) to represent native ETH wagers
    address public constant NATIVE_ETH = address(0);

    // Match states
    enum MatchStatus { PENDING, ACTIVE, RESOLVED, REFUNDED }

    struct Match {
        bytes32 gameCode;
        address player1;
        address player2;
        address token;       // address(0) = native ETH
        uint256 wagerAmount;
        uint256 totalStaked;
        uint256 createdAt;
        MatchStatus status;
        address winner;
    }

    // gameCode => Match
    mapping(bytes32 => Match) public matches;

    // gameCode => player => amount staked
    mapping(bytes32 => mapping(address => uint256)) public stakedAmount;

    // Special address to represent a draw
    address constant DRAW = address(0xdead);

    // Track accumulated admin fees
    uint256 public accumulatedAdminFees;
    mapping(address => uint256) public accumulatedTokenFees;

    // Events
    event MatchCreated(
        bytes32 indexed gameCode,
        address indexed creator,
        address indexed token,
        uint256 wagerAmount
    );

    event PlayerJoined(
        bytes32 indexed gameCode,
        address indexed joiner,
        uint256 wagerAmount
    );

    event MatchResolved(
        bytes32 indexed gameCode,
        address indexed winner,
        uint256 winnerPayout,
        uint256 adminFee
    );

    event DrawResolved(
        bytes32 indexed gameCode,
        address indexed player1,
        address indexed player2,
        uint256 refundAmount
    );

    event Refunded(
        bytes32 indexed gameCode,
        address indexed player1,
        address indexed player2,
        uint256 refundAmount
    );

    modifier onlyCoordinator() {
        require(msg.sender == coordinator, "only coordinator");
        _;
    }

    constructor() {
        coordinator = msg.sender;
    }

    /**
     * @dev Creator initiates a match. Send ETH for native wagers,
     * or set token address + wagerAmount for ERC20.
     */
    function createMatch(
        bytes32 gameCode,
        address token,
        uint256 wagerAmount
    ) external payable {
        require(matches[gameCode].createdAt == 0, "match already exists");

        uint256 actualWager;

        if (token == NATIVE_ETH) {
            require(msg.value > 0, "send ETH as wager");
            actualWager = msg.value;
        } else {
            require(wagerAmount > 0, "wager must be > 0");
            require(msg.value == 0, "do not send ETH for token wager");
            actualWager = wagerAmount;
            bool success = IERC20(token).transferFrom(
                msg.sender,
                address(this),
                wagerAmount
            );
            require(success, "transfer failed");
        }

        matches[gameCode] = Match({
            gameCode: gameCode,
            player1: msg.sender,
            player2: address(0),
            token: token,
            wagerAmount: actualWager,
            totalStaked: actualWager,
            createdAt: block.timestamp,
            status: MatchStatus.PENDING,
            winner: address(0)
        });

        stakedAmount[gameCode][msg.sender] = actualWager;

        emit MatchCreated(gameCode, msg.sender, token, actualWager);
    }

    /**
     * @dev Second player joins the match with the same wager amount.
     */
    function joinMatch(bytes32 gameCode) external payable {
        Match storage m = matches[gameCode];
        require(m.createdAt != 0, "match not found");
        require(m.status == MatchStatus.PENDING, "match not pending");
        require(m.player2 == address(0), "match already has 2 players");
        require(msg.sender != m.player1, "cannot join own match");

        if (m.token == NATIVE_ETH) {
            require(msg.value == m.wagerAmount, "must match wager amount");
        } else {
            require(msg.value == 0, "do not send ETH for token wager");
            bool success = IERC20(m.token).transferFrom(
                msg.sender,
                address(this),
                m.wagerAmount
            );
            require(success, "transfer failed");
        }

        m.player2 = msg.sender;
        m.status = MatchStatus.ACTIVE;
        m.totalStaked += m.wagerAmount;
        stakedAmount[gameCode][msg.sender] = m.wagerAmount;

        emit PlayerJoined(gameCode, msg.sender, m.wagerAmount);
    }

    /**
     * @dev Coordinator resolves match with a winner address.
     * Winner gets 95%, admin gets 5%.
     * If draw, both players refunded equally (no admin cut).
     */
    function resolveMatch(bytes32 gameCode, address winner)
        external
        onlyCoordinator
    {
        Match storage m = matches[gameCode];
        require(m.createdAt != 0, "match not found");
        require(m.status == MatchStatus.ACTIVE, "match not active");
        require(
            winner == DRAW || winner == m.player1 || winner == m.player2,
            "invalid winner"
        );

        m.status = MatchStatus.RESOLVED;
        m.winner = winner;

        if (winner == DRAW) {
            // Refund both players equally, no admin cut on draws
            uint256 refundEach = m.wagerAmount;
            _transfer(m.token, m.player1, refundEach);
            _transfer(m.token, m.player2, refundEach);

            emit DrawResolved(gameCode, m.player1, m.player2, refundEach);
        } else {
            // 95% to winner, 5% to admin
            uint256 total = m.totalStaked;
            uint256 adminFee = (total * ADMIN_BPS) / BPS_DENOMINATOR;
            uint256 winnerPayout = total - adminFee;

            _transfer(m.token, winner, winnerPayout);
            _transfer(m.token, coordinator, adminFee);

            emit MatchResolved(gameCode, winner, winnerPayout, adminFee);
        }
    }

    /**
     * @dev Public refund after 1 hour timeout.
     * Full refund, no admin cut.
     */
    function refundAfterTimeout(bytes32 gameCode) external {
        Match storage m = matches[gameCode];
        require(m.createdAt != 0, "match not found");
        require(m.status != MatchStatus.RESOLVED, "match already resolved");
        require(m.status != MatchStatus.REFUNDED, "match already refunded");
        require(
            block.timestamp >= m.createdAt + 1 hours,
            "must wait 1 hour from creation"
        );

        m.status = MatchStatus.REFUNDED;

        if (m.player1 != address(0)) {
            _transfer(m.token, m.player1, stakedAmount[gameCode][m.player1]);
        }

        if (m.player2 != address(0)) {
            _transfer(m.token, m.player2, stakedAmount[gameCode][m.player2]);
        }

        emit Refunded(gameCode, m.player1, m.player2, m.wagerAmount);
    }

    /**
     * @dev View function: get match details
     */
    function getMatch(bytes32 gameCode)
        external
        view
        returns (Match memory)
    {
        return matches[gameCode];
    }

    /**
     * @dev Coordinator can transfer role to a new address
     */
    function setCoordinator(address newCoordinator) external onlyCoordinator {
        require(newCoordinator != address(0), "invalid address");
        coordinator = newCoordinator;
    }

    /**
     * @dev Emergency: Coordinator can withdraw unclaimed ERC20 funds
     */
    function emergencyWithdraw(address token) external onlyCoordinator {
        if (token == NATIVE_ETH) {
            uint256 balance = address(this).balance;
            require(balance > 0, "no balance");
            (bool success, ) = coordinator.call{value: balance}("");
            require(success, "ETH transfer failed");
        } else {
            uint256 balance = IERC20(token).balanceOf(address(this));
            require(balance > 0, "no balance");
            IERC20(token).transfer(coordinator, balance);
        }
    }

    /**
     * @dev Internal transfer helper supporting both ETH and ERC20
     */
    function _transfer(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == NATIVE_ETH) {
            (bool success, ) = to.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            bool success = IERC20(token).transfer(to, amount);
            require(success, "token transfer failed");
        }
    }

    receive() external payable {}
}
