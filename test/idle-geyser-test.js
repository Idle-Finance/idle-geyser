const { expectEvent, singletons, constants, BN, expectRevert } = require('@openzeppelin/test-helpers');
const { ethers } = require("hardhat");
const { expect } = require("chai");

describe("IdleGeyser", function() {
  beforeEach(async () => {
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const TokenGeyser = await ethers.getContractFactory("TokenGeyser");
    this.mockIdle = await MockERC20.deploy("13000000000000000000000000"); // 13,000,000 IDLE

    this.mockLPToken = await MockERC20.deploy("100000000000000000000"); // 100 LP tokens
    
    await this.mockIdle.deployed();
    await this.mockLPToken.deployed();

    this.geyser = await TokenGeyser.deploy(
      this.mockLPToken.address,
      this.mockIdle.address,
      "10000", // maxUnlockSchedules; same value as ampleforth
      "33", // starting bonus [boosted to 3x over bonus period duration]
      "5184000", // Bonus period in seconds [2 months in seconds]
      "1000000" // initialSharesPerToken; same value as ampleforth
    );
    
    await this.geyser.deployed()
    
  });
  
  it("Should Create the Geyser Contract", async function() {
    
  });
});
