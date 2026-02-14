// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title ChessterEscrow
 * @dev Handles equal-stakes chess match wagering with backend-coordinated payouts,
 * draw support, and automatic refunds after 1 hour timeout.
 */
contract ChessterEscrow {
    address public coordinator;

    // Match states
    enum MatchStatus { PENDING, ACTIVE, RESOLVED, REFUNDED }

    struct Match {
        bytes32 gameCode;
        address player1;
        address player2;
        address token;
        uint256 wagerAmount;
        uint256 totalStaked;
        uint256 createdAt;
        MatchStatus status;
        address winner; // address for winner, or special address for draw
    }

    // gameCode => Match
    mapping(bytes32 => Match) public matches;

    // gameCode => player => amount staked
    mapping(bytes32 => mapping(address => uint256)) public stakedAmount;

    // Special address to represent a draw
    address constant DRAW = address(0xdead);

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
        uint256 payout
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
     * @dev Creator initiates a match with a wager amount.
     * Pulls wager tokens from creator's wallet (requires prior approval).
     */
    function createMatch(
        bytes32 gameCode,
        address token,
        uint256 wagerAmount
    ) external {
        require(wagerAmount > 0, "wager must be > 0");
        require(matches[gameCode].createdAt == 0, "match already exists");

        // Pull tokens from creator
        bool success = IERC20(token).transferFrom(
            msg.sender,
            address(this),
            wagerAmount
        );
        require(success, "transfer failed");

        matches[gameCode] = Match({
            gameCode: gameCode,
            player1: msg.sender,
            player2: address(0),
            token: token,
            wagerAmount: wagerAmount,
            totalStaked: wagerAmount,
            createdAt: block.timestamp,
            status: MatchStatus.PENDING,
            winner: address(0)
        });

        stakedAmount[gameCode][msg.sender] = wagerAmount;

        emit MatchCreated(gameCode, msg.sender, token, wagerAmount);
    }

    /**
     * @dev Second player joins the match with the same wager amount.
     * Pulls the same wager from joiner and marks match as ACTIVE.
     */
    function joinMatch(bytes32 gameCode) external {
        Match storage m = matches[gameCode];
        require(m.createdAt != 0, "match not found");
        require(m.status == MatchStatus.PENDING, "match not pending");
        require(m.player2 == address(0), "match already has 2 players");
        require(msg.sender != m.player1, "cannot join own match");

        // Pull same wager amount from joiner
        bool success = IERC20(m.token).transferFrom(
            msg.sender,
            address(this),
            m.wagerAmount
        );
        require(success, "transfer failed");

        m.player2 = msg.sender;
        m.status = MatchStatus.ACTIVE;
        m.totalStaked += m.wagerAmount;
        stakedAmount[gameCode][msg.sender] = m.wagerAmount;

        emit PlayerJoined(gameCode, msg.sender, m.wagerAmount);
    }

    /**
     * @dev Coordinator resolves match with a winner address.
     * If winner == DRAW, both players refund equally.
     * If winner == player1 or player2, winner gets full pot.
     * If winner == address(0), revert (invalid).
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
            // Refund both players equally
            uint256 refundEach = m.wagerAmount;
            IERC20(m.token).transfer(m.player1, refundEach);
            IERC20(m.token).transfer(m.player2, refundEach);

            emit DrawResolved(gameCode, m.player1, m.player2, refundEach);
        } else {
            // Pay winner the full pot
            IERC20(m.token).transfer(winner, m.totalStaked);

            emit MatchResolved(gameCode, winner, m.totalStaked);
        }
    }

    /**
     * @dev Public refund after 1 hour timeout.
     * Anyone can call this to refund both players if the match hasn't been resolved.
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

        // Refund player1
        if (m.player1 != address(0)) {
            IERC20(m.token).transfer(m.player1, stakedAmount[gameCode][m.player1]);
        }

        // Refund player2 (if joined)
        if (m.player2 != address(0)) {
            IERC20(m.token).transfer(m.player2, stakedAmount[gameCode][m.player2]);
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
     * @dev Coordinator can transfer to a new coordinator (e.g., for upgrades)
     */
    function setCoordinator(address newCoordinator) external onlyCoordinator {
        require(newCoordinator != address(0), "invalid address");
        coordinator = newCoordinator;
    }

    /**
     * @dev Emergency: Coordinator can withdraw unclaimed funds (should rarely happen)
     */
    function emergencyWithdraw(address token) external onlyCoordinator {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "no balance");
        IERC20(token).transfer(coordinator, balance);
    }
}
