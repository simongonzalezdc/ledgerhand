// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title QuorumRegistry
 * @notice On-chain record of AI-agent-fleet decisions over Attestcoin-verified
 *         cross-chain facts. Creditcoin (CC3) deployment.
 *
 * Trust model:
 *  - The FACT (cross-chain transaction) is already proven inside Creditcoin's
 *    trust domain by the Attestcoin BlockProver precompile (0x...FD2) — this
 *    contract deliberately does NOT re-verify it. Callers pass the factHash
 *    returned by the attestation pipeline (keccak(chainKey, headerNumber,
 *    txHash, verified)).
 *  - The DECISION is what this contract enforces: every ballot must carry a
 *    valid EIP-191 signature from the registered agent control address,
 *    ballots must bind the exact factHash/policyId/round, signers must be
 *    distinct, and approvals must meet the quorum threshold — otherwise the
 *    submission reverts.
 *  - The recorded decision becomes a Creditcoin state fact (mapping + event)
 *    any downstream protocol can consume: release collateral, mark repaid,
 *    gate credit lines, settle DePIN invoices, etc.
 */
contract QuorumRegistry {
    struct Decision {
        bytes32 certHash;
        uint8 decision; // 0 = REJECT, 1 = EXECUTE
        uint8 approvals;
        uint8 fleetSize;
        uint64 timestamp;
    }

    /// @notice agentId => registered control address (fleet roster, set by owner)
    mapping(bytes32 => address) public agentControl;
    /// @notice factHash => recorded decision
    mapping(bytes32 => Decision) public decisions;

    address public owner;

    event AgentRegistered(bytes32 indexed agentId, address indexed control);
    event DecisionRecorded(
        bytes32 indexed certHash,
        bytes32 indexed factHash,
        bytes32 policyId,
        uint8 decision,
        uint8 approvals,
        uint8 fleetSize
    );

    error BadQuorum();
    error BadSigner();
    error DuplicateSigner();
    error AlreadyRecorded();
    error NotOwner();

    constructor() {
        owner = msg.sender;
    }

    function registerAgent(bytes32 agentId, address control) external {
        if (msg.sender != owner) revert NotOwner();
        agentControl[agentId] = control;
        emit AgentRegistered(agentId, control);
    }

    /**
     * @notice Record a fleet decision over an Attestcoin-verified fact.
     * @param factHash keccak(chainKey, headerNumber, txHash, verified) from the attestation pipeline
     * @param policyId keccak of the lending policy the fleet deliberated against
     * @param decision 0 = REJECT, 1 = EXECUTE (executed only if quorum is met)
     * @param agentIds keccak agent ids, parallel to the other arrays
     * @param signers  expected control addresses (empty entry = any address allowed)
     * @param r        EIP-191 signature r components
     * @param s        EIP-191 signature s components
     * @param v        EIP-191 signature v components (27/28)
     * @param votes    per-ballot vote (0 ABSTAIN, 1 APPROVE, 2 DENY), parallel array
     * @param requiredApprovals quorum threshold for EXECUTE
     * @return certHash keccak of the canonical certificate
     */
    function submitDecision(
        bytes32 factHash,
        bytes32 policyId,
        uint8 decision,
        bytes32[] calldata agentIds,
        address[] calldata signers,
        bytes32[] calldata r,
        bytes32[] calldata s,
        uint8[] calldata v,
        uint8[] calldata votes,
        uint8 requiredApprovals
    ) external returns (bytes32 certHash) {
        uint256 n = agentIds.length;
        if (n == 0 || n != signers.length || n != r.length || n != s.length || n != v.length || n != votes.length) {
            revert BadQuorum();
        }
        if (decisions[factHash].timestamp != 0) revert AlreadyRecorded();

        address[] memory seen = new address[](n);
        uint8 approvals;
        for (uint256 i = 0; i < n; i++) {
            // Ballot digest — must match exactly what the agent signed off-chain.
            bytes32 digest = keccak256(
                abi.encodePacked(factHash, policyId, uint8(2), agentIds[i], votes[i])
            );
            bytes32 ethDigest = keccak256(
                abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
            );
            address recovered = ecrecover(ethDigest, v[i], r[i], s[i]);
            if (recovered == address(0)) revert BadSigner();
            if (signers[i] != address(0) && recovered != signers[i]) revert BadSigner();
            for (uint256 j = 0; j < i; j++) {
                if (seen[j] == recovered) revert DuplicateSigner();
            }
            seen[i] = recovered;
            if (votes[i] == 1) approvals++;
        }

        // Quorum gate: EXECUTE requires the threshold; anything else records REJECT.
        uint8 effective = (approvals >= requiredApprovals && decision == 1) ? 1 : 0;

        certHash = keccak256(abi.encodePacked("QUORUMPROOF_V1", factHash, policyId, effective, uint8(n)));
        decisions[factHash] = Decision({
            certHash: certHash,
            decision: effective,
            approvals: approvals,
            fleetSize: uint8(n),
            timestamp: uint64(block.timestamp)
        });
        emit DecisionRecorded(certHash, factHash, policyId, effective, approvals, uint8(n));
    }
}
