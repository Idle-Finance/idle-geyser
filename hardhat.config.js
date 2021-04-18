require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-web3");

require('dotenv').config()

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`
      }
    },
    local: {
      url: "http://127.0.0.1:8545"
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_MAINNET_KEY}`
    },
    kovan: {
      url: `https://kovan.infura.io/v3/${process.env.INFURA_KOVAN_KEY}`
    }
  },
  solidity: "0.5.0",
};

