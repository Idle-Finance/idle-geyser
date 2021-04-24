// We require the Hardhat Runtime Environment explicitly here. This is optional 
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat")

const { HardwareSigner } = require("../lib/HardwareSigner")
const { addresses } = require("../lib/index")
const {check} = require("./helpers")


async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile 
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // initialise signer object, 
  let signer;
  
  let networkName = hre.network.name;
  switch (networkName) {
    case 'hardhat':
      signer = (await hre.ethers.getSigners())[0]; break;
    case 'mainnet':
      signer = new HardwareSigner(ethers.provider, null, "m/44'/60'/0'/0/0"); break;
    default:
      throw `Invalid network detected for deployment: ${networkName}`
  }

  console.log(`########## DEPLOYING TO ${networkName} ##########`)
  senderAddress = await signer.getAddress()
  senderBalance = await signer.getBalance()
  console.log(`Using sender address ${senderAddress}`)
  console.log(`Sender Balance (ETH): ${senderBalance}`)

  const MasterChefTokenizer = await hre.ethers.getContractFactory("MasterChefTokenizer", signer);
  const TokenGeyser = await hre.ethers.getContractFactory("TokenGeyser", signer);
  
  const sushiLPToken = addresses.networks.mainnet.sushiLPToken
  const idleToken = addresses.networks.mainnet.idle
  const masterchefPoolId = addresses.networks.mainnet.sushiLPPid

  console.log(`Using the following address for LP Token: ${sushiLPToken}`)
  console.log(`Using the following address for idle Token: ${idleToken}`)
  console.log(`Using the following masterchef pool id: ${masterchefPoolId}`)
  console.log()
  
  console.log("Deploying tokenizer")
  let tokenizer = await MasterChefTokenizer.deploy(
    "Wrapper sushi IDLE/ETH LP",
    "wIDLESushiLP",
    sushiLPToken,
    masterchefPoolId
  );
  await tokenizer.deployed();
  let tokenizerReceipt = await tokenizer.deployTransaction.wait()
  console.log(`Tokenizer created: ${tokenizer.address} @tx: ${tokenizerReceipt.transactionHash}`);
  console.log()

  console.log("Deploying Geyser")
  let geyser = await TokenGeyser.deploy(
    tokenizer.address,
    idleToken,
    "10000", // maxUnlockSchedules; same value as ampleforth
    "33", // starting bonus [boosted to 3x over bonus period duration]
    "10368000", // Bonus period in seconds [4 months in seconds]
    "1000000", // initialSharesPerToken; same value as ampleforth
    sushiLPToken // unwrappedStakingToken_
  );
  await geyser.deployed()
  let geyserReceipt = await geyser.deployTransaction.wait()
  console.log(`Geyser created: ${geyser.address} @tx: ${geyserReceipt.transactionHash}`)
  console.log()
  
  console.log(`Set geyser in tokenizer: ${geyser.address}`);
  await tokenizer.transferGeyser(geyser.address)

  console.log(`Transfering Geyser ownership to multisig: ${addresses.multisigAddress}`)
  await geyser.transferOwnership(addresses.multisigAddress)

  console.log(`Transfering Tokenizer ownership to multisig: ${addresses.multisigAddress}`)
  await tokenizer.transferOwnership(addresses.multisigAddress)
  
  // from here the multisigAddress must create the funding schedule
  // done by calling `lockTokens`
  console.log()
  console.log("Verifying Deployment")
  let geyserOwner = await geyser.owner()
  let tokenizerOwner = await tokenizer.owner()
  let tokenizerGeyser = await tokenizer.geyser()
  let stakingToken = await geyser.getStakingToken()
  let stakingRewardToken = await geyser.getDistributionToken()
  let tokenizerToken = await tokenizer.token()

  check(geyserOwner, addresses.multisigAddress, "Geyser Owner is idle multisig")
  check(tokenizerOwner, addresses.multisigAddress, "Tokenizer Owner is idle multisig")
  check(tokenizerGeyser, geyser.address, "Tokenizer Geyser address is correct")

  check(stakingToken, tokenizer.address, "staking token is wLP token from tokenizer")
  check(stakingRewardToken, idleToken, "Reward token is IDLE")
  
  check(tokenizerToken, sushiLPToken, "Tokenizer token is sushiLP")

  console.log(`Contract deployment '${networkName}' complete`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
