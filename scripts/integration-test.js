// script for testing a full deployment, including gnosis multisig interaction on local fork

const { ethers } = require("hardhat");
const hre = require("hardhat")
const { addresses } = require("../lib/index")
const {time} = require("@openzeppelin/test-helpers")

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile 
  // manually to make sure everything is compiled
  // await hre.run('compile');
  
  let networkName = hre.network.name
  if (networkName != "hardhat") {
    throw "This script can only run in hardhat network at this time"
  }

  // impersonate gnosis multisig
  await hre.network.provider.request({method: "hardhat_impersonateAccount", params: [addresses.multisigAddress]})

  let signer = (await hre.ethers.getSigners())[0];
  senderAddress = await signer.getAddress()

  let multisigSigner = await ethers.provider.getSigner(addresses.multisigAddress)

  // transfer 10 ETH to multisig
  await signer.sendTransaction({to: addresses.multisigAddress, value: ethers.utils.parseEther("10")}) // 10 ETH
  
  console.log(`########## PERFORMING MOCK DEPLOYMENT TO ${networkName} ##########`) 
  console.log(`Using sender address ${senderAddress}`)

  const TokenGeyser = await hre.ethers.getContractFactory("TokenGeyser", signer)
  const MockERC20 = await ethers.getContractFactory("MockERC20", signer)

  let mockLP = await MockERC20.deploy("100000000000000000000") // 100 LP tokens
  await mockLP.deployed()
  let LPToken = mockLP.address
  let idleToken = addresses.networks.mainnet.idle
  
  console.log(`Using the following address for LP Token: ${LPToken}`)
  console.log(`Using the following address for idle Token: ${idleToken}`)

  let geyser = await TokenGeyser.deploy(
    LPToken,
    idleToken,
    "10000", // maxUnlockSchedules; same value as ampleforth
    "33", // starting bonus [boosted to 3x over bonus period duration]
    "10368000", // Bonus period in seconds [4 months in seconds]
    "1000000" // initialSharesPerToken; same value as ampleforth
  )

  await geyser.deployed()
  console.log(`Geyser created: ${geyser.address}`)
  
  console.log(`Transfering ownership to multisig: ${addresses.multisigAddress}`)
  await geyser.transferOwnership(addresses.multisigAddress)
  

  // from here the multisigAddress must create the funding schedule
  // done by calling `lockTokens`
  console.log(`Contract deployment '${networkName}' complete`)
  
  console.log("Impersonating Multisig")
  let multiSigGeyser = await geyser.connect(multisigSigner) // geyser controlled by multisig

  const idleTokenContract = await hre.ethers.getContractAt("MockERC20", idleToken, multisigSigner)

  console.log("Approving geyser contract to use idle")
  await idleTokenContract.approve(multiSigGeyser.address, ethers.constants.MaxUint256) // signed by multisig

  console.log("Locking 1000 IDLE for 6 months")
  await multiSigGeyser.lockTokens("1000000000000000000000", "15552000") // Test with 1000 IDLE

  console.log("Approving IDLE for geyser")
  await mockLP.approve(multiSigGeyser.address, ethers.constants.MaxUint256)
  
  console.log("Staking 100 LP tokens")
  await geyser.stake("100000000000000000000", "0x") // stake LP token

  time.increase(time.duration.days(30*6+1)) // 30 days = 1 month
  // await hre.network.provider.request({method: "evm_increaseTime", params: ["15552000"]})

  console.log("Unstaking 100 LP tokens")
  await geyser.unstake("100000000000000000000", "0x")

  let finalBalance = await idleTokenContract.balanceOf(senderAddress)
  console.log(finalBalance.toString())
  
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
  