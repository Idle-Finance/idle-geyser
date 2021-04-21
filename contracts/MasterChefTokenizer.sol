pragma solidity 0.5.17;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20Detailed.sol";
import "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

interface IMasterChef {
  function deposit(uint256 _pid, uint256 _amount) external;
  function withdraw(uint256 _pid, uint256 _amount) external;
}

contract MasterChefTokenizer is Ownable, ERC20, ERC20Detailed {
  using SafeERC20 for IERC20;
  using SafeMath for uint256;

  address public token; // sushi LP share
  address public masterChef;
  uint256 public pid;

  constructor(
    string memory _name, // eg. IdleDAI
    string memory _symbol, // eg. IDLEDAI
    address _token,
    uint256 _pid
  ) public ERC20Detailed(_name, _symbol, uint8(18)) {
    token = _token;
    pid = _pid;
    masterChef = address(0xc2EdaD668740f1aA35E4D8f227fB8E17dcA888Cd);
    Ownable(msg.sender);
    IERC20(_token).approve(masterChef, uint256(-1));
  }

  function wrap(uint256 _amount) external {
    IERC20(token).safeTransferFrom(msg.sender, address(this), _amount);
    IMasterChef(masterChef).deposit(pid, _amount);
    _mint(msg.sender, _amount);
  }

  function unwrap(uint256 _amount, address _account) external {
    IMasterChef(masterChef).withdraw(pid, _amount);
    _burn(msg.sender, _amount);
    IERC20(token).safeTransfer(_account, _amount);
  }

  // used both to rescue SUSHI rewards and eventually other tokens
  function rescueFunds(address tokenToRescue, address to, uint256 amount) external onlyOwner returns (bool) {
    return IERC20(tokenToRescue).transfer(to, amount);
  }
}
