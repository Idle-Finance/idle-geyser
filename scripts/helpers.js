const {time} = require("@openzeppelin/test-helpers")

module.exports = {
  check: (a, b, message) => {
    a = a.toString();
    b = b.toString();
    let [icon, symbol] = a.toString() === b ? ["✔️", "==="] : ["🚨🚨🚨", "!=="];
    console.log(`${icon}  `, a, symbol, b, message ? message : "");
  },
  checkIncreased: (a, b, message) => {
    let [icon, symbol] = b.gt(a) ? ["✔️", "<"] : ["🚨🚨🚨", ">="];
    console.log(`${icon}  `, a.toString(), symbol, b.toString(), message ? message : "");
  },
  toETH: n => ethers.utils.parseEther(n.toString()),
  sudo: async (acc, contract) => {
    await hre.network.provider.request({method: "hardhat_impersonateAccount", params: [acc]});
    const signer = await ethers.provider.getSigner(acc);
    if (contract) {
      contract = await contract.connect(signer);
    }
    return [contract, signer];
  },
  waitDays: async d => {
    await time.increase(time.duration.days(d));
  },
  resetFork: async blockNumber => {
    console.log('resetting fork')
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: `https://eth-mainnet.alchemyapi.io/v2/oO-FJDpNYajB4VNK9Wx5jj5ibmR2AWbO`,
            blockNumber,
          }
        }
      ]
    });
  }
}
