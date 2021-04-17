// We require the Hardhat Runtime Environment explicitly here. This is optional 
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat")

const { HardwareSigner } = require("../lib/HardwareSigner")
const { addresses } = require("../lib/index")

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile 
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // initialise signer object, 
  let signer;

  let LPToken;
  let idleToken;
  
  let networkName = hre.network.name;
  switch (networkName) {
    case 'local':
      signer = (await hre.ethers.getSigners())[0]; break;
    case 'fork':
      signer = (await hre.ethers.getSigners())[0]; break;
    case 'kovan':
      signer = new HardwareSigner(ethers.provider, null, "m/44'/60'/1'/0/0"); break; // Use seperate account for kovan
    case 'mainnet':
      signer = new HardwareSigner(ethers.provider, null, "m/44'/60'/0'/0/0"); break;
    default:
      throw `Invalid network detected for deployment: ${networkName}`
  }

  console.log(`########## DEPLOYING TO ${networkName} ##########`)
  senderAddress = await signer.getAddress()
  console.log(`Using sender address ${senderAddress}`)

  if (networkName == "mainnet" || networkName == "fork") {
    LPToken = addresses.networks.mainnet.sushiLPToken
    idleToken = addresses.networks.mainnet.idle
  } else {
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20", signer);
    
    // Tokens have 18 decimal places
    console.log("Deploying mock LP Token")
    let mockLPToken = await MockERC20.deploy("100000000000000000000"); // 100 LP tokens
    LPToken = mockLPToken.address;
    
    if (networkName == "kovan") {
      idleToken = addresses.networks.kovan.idle // use kovan IDLE
    } else {
      console.log("Deploying mock idle token")
      let mockIdle = await MockERC20.deploy("13000000000000000000000000"); // 13,000,000 IDLE
      await mockLPToken.deployed();
      await mockIdle.deployed()
      idleToken = mockIdle.address
    }
  }

  const TokenGeyser = await hre.ethers.getContractFactory("TokenGeyser", signer);
  
  console.log(`Using the following address for LP Token: ${LPToken}`)
  console.log(`Using the following address for idle Token: ${idleToken}`)

  let geyser = await TokenGeyser.deploy(
    LPToken,
    idleToken,
    "10000", // maxUnlockSchedules; same value as ampleforth
    "33", // starting bonus [boosted to 3x over bonus period duration]
    "5184000", // Bonus period in seconds [2 months in seconds]
    "1000000" // initialSharesPerToken; same value as ampleforth
  )

  await geyser.deployed()
  console.log(`Geyser created: ${geyser.address}`)
  
  
  console.log(`Transfering ownership to multisig: ${addresses.multisigAddress}`)
  await geyser.transferOwnership(addresses.multisigAddress)
  
  console.log(`Contract deployed to ${networkName}`)
  // from here the multisigAddress must create the funding schedule
  // done by calling `lockTokens`
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
