// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat")

const { HardwareSigner } = require("../lib/HardwareSigner")
const { addresses } = require("../lib/index")
const { check } = require("./helpers")

const { LedgerSigner } = require("@ethersproject/hardware-wallets");


async function deployContracts() {
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
    case 'matic':
      signer = new LedgerSigner(ethers.provider, undefined, "m/44'/60'/0'/0/0"); break;
    default:
      throw `Invalid network detected for deployment: ${networkName}`
  }

  console.log(`########## DEPLOYING TO ${networkName} ##########`)
  senderAddress = await signer.getAddress()
  senderBalance = await signer.getBalance()
  console.log(`Using sender address ${senderAddress}`)
  console.log(`Sender Balance (ETH): ${senderBalance}`)

  const MasterChefTokenizerPolygon = await hre.ethers.getContractFactory("MasterChefTokenizerPolygon", signer);
  const TokenGeyserPolygon = await hre.ethers.getContractFactory("TokenGeyserPolygon", signer);

  const sushiLPToken = await hre.ethers.getContractAt("IERC20", addresses.networks.matic.sushiLPToken)
  const idleToken = await hre.ethers.getContractAt("IERC20", addresses.networks.matic.idle)
  const masterchefPoolId = addresses.networks.matic.sushiLPPid

  console.log(`Using the following address for LP Token: ${sushiLPToken.address}`)
  console.log(`Using the following address for idle Token: ${idleToken.address}`)
  console.log(`Using the following masterchef pool id: ${masterchefPoolId}`)
  console.log()

  console.log("Deploying tokenizer")
  let tokenizer = await MasterChefTokenizerPolygon.deploy(
    "Wrapper sushi IDLE/ETH LP",
    "wIDLESushiLP",
    sushiLPToken.address,
    masterchefPoolId
  );
  await tokenizer.deployed();
  let tokenizerReceipt = await tokenizer.deployTransaction.wait()
  console.log(`Tokenizer created: ${tokenizer.address} @tx: ${tokenizerReceipt.transactionHash}`);
  console.log()

  console.log("Deploying Geyser")
  let geyser = await TokenGeyserPolygon.deploy(
    tokenizer.address,
    idleToken.address,
    "10000", // maxUnlockSchedules; same value as ampleforth
    "33", // starting bonus [boosted to 3x over bonus period duration]
    "5184000", // Bonus period in seconds [2 months in seconds]
    "1000000", // initialSharesPerToken; same value as ampleforth
    sushiLPToken.address // unwrappedStakingToken_
  );
  await geyser.deployed()
  let geyserReceipt = await geyser.deployTransaction.wait()
  console.log(`Geyser created: ${geyser.address} @tx: ${geyserReceipt.transactionHash}`)
  console.log()

  console.log(`Set geyser in tokenizer: ${geyser.address}`);
  await tokenizer.transferGeyser(geyser.address)

  console.log("Contracts deployed, performing intermediate checks")
  let tokenizerGeyser = await tokenizer.geyser()
  let stakingToken = await geyser.getStakingToken()
  let stakingRewardToken = await geyser.getDistributionToken()
  let tokenizerToken = await tokenizer.token()

  check(tokenizerGeyser.toLowerCase(), geyser.address.toLowerCase(), "Tokenizer Geyser address is correct")

  check(stakingToken.toLowerCase(), tokenizer.address.toLowerCase(), "staking token is wLP token from tokenizer")
  check(stakingRewardToken.toLowerCase(), idleToken.address.toLowerCase(), "Reward token is IDLE")

  check(tokenizerToken.toLowerCase(), sushiLPToken.address.toLowerCase(), "Tokenizer token is sushiLP")

  // let geyser = await hre.ethers.getContractAt("TokenGeyserPolygon", addresses.networks.matic.geyser, signer);
  // let tokenizer = await hre.ethers.getContractAt("MasterChefTokenizerPolygon", addresses.networks.matic.tokenizer, signer);

  console.log(`Transfering Geyser ownership to multisig: ${addresses.networks.matic.multisigAddress}`)
  await geyser.transferOwnership(addresses.networks.matic.multisigAddress)

  console.log(`Transfering Tokenizer ownership to multisig: ${addresses.networks.matic.multisigAddress}`)
  await tokenizer.transferOwnership(addresses.networks.matic.multisigAddress)

  // from here the multisigAddress must create the funding schedule
  // done by calling `lockTokens`
  console.log()
  console.log("Verifying Deployment")
  let geyserOwner = await geyser.owner()
  let tokenizerOwner = await tokenizer.owner()

  check(geyserOwner, addresses.networks.matic.multisigAddress, "Geyser Owner is idle multisig")
  check(tokenizerOwner, addresses.networks.matic.multisigAddress, "Tokenizer Owner is idle multisig")

  console.log(`Contract deployment '${networkName}' complete`)
  return [geyser, tokenizer, sushiLPToken, idleToken]
}

module.exports = deployContracts

async function main() {
  await deployContracts()
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
