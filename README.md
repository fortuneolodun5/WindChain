# 🌬️ WindChain: Transparent Wind Farm Revenue Sharing

Welcome to WindChain, a decentralized platform built on the Stacks blockchain that addresses the lack of transparency in renewable energy projects. Community-funded wind farms often suffer from opaque reporting on energy production and revenue distribution, leading to distrust among investors. WindChain uses an immutable ledger to track wind farm outputs, enabling fair and verifiable revenue sharing for community investors. By leveraging blockchain, we ensure all data is tamper-proof, auditable, and automated through smart contracts written in Clarity.

## ✨ Features

🔒 Immutable tracking of wind farm energy outputs via trusted oracles  
💰 Community investment pooling with tokenized shares  
📊 Automated revenue calculation and distribution based on real outputs  
🗳️ Governance for investor voting on key decisions  
📈 Real-time dashboards for output and revenue transparency (off-chain integration)  
🚨 Dispute resolution mechanism for output verification  
🔐 Secure user registration and KYC-like verification  
✅ Audit trails for all transactions and distributions  

## 🛠 How It Works

**For Wind Farm Owners**  
- Register your wind farm with details like location, capacity, and oracle feeds.  
- Periodically submit or allow oracle-submitted energy output data (e.g., kWh produced).  
- Revenues from energy sales are deposited into the platform, triggering automated distributions.  

**For Community Investors**  
- Register as an investor and browse available wind farms.  
- Invest STX (Stacks tokens) to receive share tokens proportional to your contribution.  
- Monitor real-time outputs and projected revenues.  
- Receive automated payouts based on your share ownership and verified farm outputs.  
- Participate in governance votes, such as approving new oracles or resolving disputes.  

**Core Process**  
1. Outputs are logged immutably via oracles.  
2. Revenues are calculated (e.g., based on energy sold at market rates).  
3. Smart contracts distribute funds proportionally to investors.  
4. All actions are logged for eternal auditability.  

Boom! Transparent, trustless renewable energy investing.

## 📜 Smart Contracts Overview

WindChain is powered by 8 interconnected smart contracts written in Clarity, ensuring modularity, security, and composability on the Stacks blockchain. Here's a breakdown:

1. **UserRegistry.clar**: Handles user registration, investor profiles, and basic verification (e.g., mapping principals to roles like investor or owner). Prevents unauthorized access.

2. **WindFarmRegistry.clar**: Registers wind farms with metadata (ID, owner, capacity, location). Allows updates only by owners and tracks status (active/inactive).

3. **OracleFeed.clar**: Manages trusted oracles for submitting real-world data like energy outputs. Includes validation logic to prevent invalid submissions and supports multiple oracles for redundancy.

4. **OutputTracker.clar**: Logs immutable energy output records (e.g., timestamped kWh data). Uses maps for historical tracking and emits events for off-chain monitoring.

5. **InvestmentPool.clar**: Creates investment pools for each wind farm. Handles STX deposits, calculates share allocations, and integrates with the token contract for minting.

6. **ShareToken.clar**: Implements a SIP-010 compliant fungible token for representing ownership shares in wind farms. Includes transfer restrictions to verified investors.

7. **RevenueDistributor.clar**: Calculates revenues based on outputs (e.g., output * rate) and distributes STX proportionally to share holders. Automates payouts with time-locked periods.

8. **Governance.clar**: Enables token-weighted voting for proposals (e.g., adding oracles, disputing outputs). Tracks votes, executes outcomes, and logs decisions immutably.

These contracts interact seamlessly: For example, OutputTracker feeds data to RevenueDistributor, which queries ShareToken for distributions. All are designed with Clarity's safety features to avoid reentrancy and ensure decidability.

## 🚀 Getting Started

Deploy the contracts on Stacks testnet using the Clarinet toolkit. Integrate with off-chain oracles (e.g., via Chainlink on Stacks) for real outputs. For a demo, simulate outputs in a local environment.

Join the renewable energy revolution with WindChain—transparent, equitable, and blockchain-powered!