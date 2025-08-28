// RevenueDistributor.test.ts
import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface DistributionRecord {
  totalRevenue: number;
  totalShares: number;
  perShare: number;
  distributedAt: number;
  claimed: number;
}

interface ClaimRecord {
  claimedAmount: number;
  claimedAt: number;
}

interface ContractState {
  contractOwner: string;
  isPaused: boolean;
  defaultRate: number;
  treasuryFee: number;
  farmRates: Map<number, number>;
  distributions: Map<string, DistributionRecord>; // key: `${farmId}-${period}`
  userClaims: Map<string, ClaimRecord>; // key: `${farmId}-${period}-${user}`
  pendingDeposits: Map<number, number>;
  contractBalance: number;
}

// Mock dependencies
class MockOutputTracker {
  periodOutputs: Map<string, number> = new Map(); // key: `${farmId}-${period}`
  lastPeriods: Map<number, number> = new Map();

  getPeriodOutput(farmId: number, period: number): ClarityResponse<number> {
    const key = `${farmId}-${period}`;
    const output = this.periodOutputs.get(key) ?? 0;
    return output > 0 ? { ok: true, value: output } : { ok: false, value: 102 };
  }

  getLastPeriod(farmId: number): ClarityResponse<number> {
    return { ok: true, value: this.lastPeriods.get(farmId) ?? 0 };
  }
}

class MockShareToken {
  balances: Map<string, number> = new Map();
  totalSupply: number = 0;

  getBalance(user: string): ClarityResponse<number> {
    return { ok: true, value: this.balances.get(user) ?? 0 };
  }

  getTotalSupply(): ClarityResponse<number> {
    return { ok: true, value: this.totalSupply };
  }

  transfer(amount: number, from: string, to: string): ClarityResponse<boolean> {
    const fromBal = this.balances.get(from) ?? 0;
    if (fromBal < amount) return { ok: false, value: 111 };
    this.balances.set(from, fromBal - amount);
    const toBal = this.balances.get(to) ?? 0;
    this.balances.set(to, toBal + amount);
    return { ok: true, value: true };
  }
}

class MockWindFarmRegistry {
  farmOwners: Map<number, string> = new Map();
  farmActive: Map<number, boolean> = new Map();

  getFarmOwner(farmId: number): ClarityResponse<string> {
    const owner = this.farmOwners.get(farmId);
    return owner ? { ok: true, value: owner } : { ok: false, value: 101 };
  }

  isFarmActive(farmId: number): ClarityResponse<boolean> {
    return { ok: true, value: this.farmActive.get(farmId) ?? false };
  }
}

// Mock contract implementation
class RevenueDistributorMock {
  private state: ContractState = {
    contractOwner: "deployer",
    isPaused: false,
    defaultRate: 100,
    treasuryFee: 5,
    farmRates: new Map(),
    distributions: new Map(),
    userClaims: new Map(),
    pendingDeposits: new Map(),
    contractBalance: 0,
  };

  private outputTracker: MockOutputTracker;
  private shareToken: MockShareToken;
  private windFarmRegistry: MockWindFarmRegistry;

  constructor() {
    this.outputTracker = new MockOutputTracker();
    this.shareToken = new MockShareToken();
    this.windFarmRegistry = new MockWindFarmRegistry();
  }

  // Helper to set mocks
  setMockFarm(farmId: number, owner: string, active: boolean) {
    this.windFarmRegistry.farmOwners.set(farmId, owner);
    this.windFarmRegistry.farmActive.set(farmId, active);
  }

  setMockOutput(farmId: number, period: number, output: number) {
    this.outputTracker.periodOutputs.set(`${farmId}-${period}`, output);
  }

  setMockShares(totalSupply: number, balances: { [user: string]: number }) {
    this.shareToken.totalSupply = totalSupply;
    for (const [user, bal] of Object.entries(balances)) {
      this.shareToken.balances.set(user, bal);
    }
  }

  setRate(caller: string, farmId: number, newRate: number): ClarityResponse<boolean> {
    const owner = this.windFarmRegistry.farmOwners.get(farmId);
    if (!owner || caller !== owner) return { ok: false, value: 100 };
    if (newRate <= 0 || newRate > 1000000) return { ok: false, value: 109 };
    this.state.farmRates.set(farmId, newRate);
    return { ok: true, value: true };
  }

  depositRevenue(caller: string, farmId: number, amount: number): ClarityResponse<boolean> {
    if (this.state.isPaused) return { ok: false, value: 106 };
    const owner = this.windFarmRegistry.farmOwners.get(farmId);
    if (!owner || caller !== owner) return { ok: false, value: 100 };
    if (amount <= 0) return { ok: false, value: 103 };
    const current = this.state.pendingDeposits.get(farmId) ?? 0;
    this.state.pendingDeposits.set(farmId, current + amount);
    this.state.contractBalance += amount;
    return { ok: true, value: true };
  }

  initiateDistribution(caller: string, farmId: number, period: number): ClarityResponse<boolean> {
    if (this.state.isPaused) return { ok: false, value: 106 };
    const owner = this.windFarmRegistry.farmOwners.get(farmId);
    if (!owner || caller !== owner) return { ok: false, value: 100 };
    const outputResp = this.outputTracker.getPeriodOutput(farmId, period);
    if (!outputResp.ok) return outputResp;
    const rate = this.state.farmRates.get(farmId) ?? this.state.defaultRate;
    const calculated = (outputResp.value * rate) / 1000000;
    const deposited = this.state.pendingDeposits.get(farmId) ?? 0;
    const totalRevenue = Math.min(calculated, deposited);
    const totalSharesResp = this.shareToken.getTotalSupply();
    if (totalRevenue <= 0 || totalSharesResp.value <= 0) return { ok: false, value: 103 };
    const feeApplied = (totalRevenue * (1000 - this.state.treasuryFee)) / 1000;
    const perShare = (feeApplied * 1000000) / totalSharesResp.value;
    const key = `${farmId}-${period}`;
    if (this.state.distributions.has(key)) return { ok: false, value: 104 };
    this.state.distributions.set(key, {
      totalRevenue,
      totalShares: totalSharesResp.value,
      perShare,
      distributedAt: 1000, // mock block
      claimed: 0,
    });
    this.state.pendingDeposits.delete(farmId);
    return { ok: true, value: true };
  }

  claimDistribution(caller: string, farmId: number, period: number): ClarityResponse<number> {
    if (this.state.isPaused) return { ok: false, value: 106 };
    const distKey = `${farmId}-${period}`;
    const dist = this.state.distributions.get(distKey);
    if (!dist) return { ok: false, value: 107 };
    const balanceResp = this.shareToken.getBalance(caller);
    const pending = (dist.perShare * balanceResp.value) / 1000000;
    if (pending <= 0) return { ok: false, value: 105 };
    const claimKey = `${farmId}-${period}-${caller}`;
    if (this.state.userClaims.has(claimKey)) return { ok: false, value: 108 };
    if (this.state.contractBalance < pending) return { ok: false, value: 111 };
    this.state.contractBalance -= pending;
    dist.claimed += pending;
    this.state.userClaims.set(claimKey, {
      claimedAmount: pending,
      claimedAt: 1000, // mock
    });
    return { ok: true, value: pending };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) return { ok: false, value: 100 };
    this.state.isPaused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) return { ok: false, value: 100 };
    this.state.isPaused = false;
    return { ok: true, value: true };
  }

  getDistributionDetails(farmId: number, period: number): ClarityResponse<DistributionRecord | null> {
    const key = `${farmId}-${period}`;
    return { ok: true, value: this.state.distributions.get(key) ?? null };
  }

  getPendingClaim(farmId: number, period: number, user: string): ClarityResponse<number> {
    const distKey = `${farmId}-${period}`;
    const dist = this.state.distributions.get(distKey);
    if (!dist) return { ok: true, value: 0 };
    const bal = this.shareToken.balances.get(user) ?? 0;
    return { ok: true, value: (dist.perShare * bal) / 1000000 };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  farmOwner: "farm_owner",
  investor1: "investor1",
  investor2: "investor2",
};

describe("RevenueDistributor Contract", () => {
  let contract: RevenueDistributorMock;

  beforeEach(() => {
    contract = new RevenueDistributorMock();
  });

  it("should allow farm owner to set custom rate", () => {
    contract.setMockFarm(1, accounts.farmOwner, true);
    const result = contract.setRate(accounts.farmOwner, 1, 200);
    expect(result).toEqual({ ok: true, value: true });
  });

  it("should prevent non-owner from setting rate", () => {
    contract.setMockFarm(1, accounts.farmOwner, true);
    const result = contract.setRate(accounts.investor1, 1, 200);
    expect(result).toEqual({ ok: false, value: 100 });
  });

  it("should allow deposit revenue by farm owner", () => {
    contract.setMockFarm(1, accounts.farmOwner, true);
    const result = contract.depositRevenue(accounts.farmOwner, 1, 10000);
    expect(result).toEqual({ ok: true, value: true });
    expect(contract.state.contractBalance).toBe(10000);
  });

  it("should prevent deposit when paused", () => {
    contract.setMockFarm(1, accounts.farmOwner, true);
    contract.pauseContract(accounts.deployer);
    const result = contract.depositRevenue(accounts.farmOwner, 1, 10000);
    expect(result).toEqual({ ok: false, value: 106 });
  });

  it("should allow investors to claim distribution", () => {
    contract.setMockFarm(1, accounts.farmOwner, true);
    contract.setMockOutput(1, 1, 100000);
    contract.setMockShares(1000, { [accounts.investor1]: 500 });
    contract.depositRevenue(accounts.farmOwner, 1, 10000);
    contract.initiateDistribution(accounts.farmOwner, 1, 1);
    const claimResult = contract.claimDistribution(accounts.investor1, 1, 1);
    expect(claimResult.ok).toBe(true);
    expect(claimResult.value).toBeGreaterThan(0);
  });

  it("should prevent double claims", () => {
    contract.setMockFarm(1, accounts.farmOwner, true);
    contract.setMockOutput(1, 1, 100000);
    contract.setMockShares(1000, { [accounts.investor1]: 500 });
    contract.depositRevenue(accounts.farmOwner, 1, 10000);
    contract.initiateDistribution(accounts.farmOwner, 1, 1);
    contract.claimDistribution(accounts.investor1, 1, 1);
    const secondClaim = contract.claimDistribution(accounts.investor1, 1, 1);
    expect(secondClaim).toEqual({ ok: false, value: 108 });
  });

  it("should calculate pending claim correctly", () => {
    contract.setMockFarm(1, accounts.farmOwner, true);
    contract.setMockOutput(1, 1, 100000);
    contract.setMockShares(1000, { [accounts.investor1]: 500 });
    contract.depositRevenue(accounts.farmOwner, 1, 10000);
    contract.initiateDistribution(accounts.farmOwner, 1, 1);
    const pending = contract.getPendingClaim(1, 1, accounts.investor1);
    expect(pending.value).toBeGreaterThan(0);
  });

  it("should pause and unpause contract", () => {
    const pause = contract.pauseContract(accounts.deployer);
    expect(pause).toEqual({ ok: true, value: true });
    expect(contract.state.isPaused).toBe(true);

    const unpause = contract.unpauseContract(accounts.deployer);
    expect(unpause).toEqual({ ok: true, value: true });
    expect(contract.state.isPaused).toBe(false);
  });
});