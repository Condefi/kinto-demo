import { useEffect, useState } from "react";
import { createKintoSDK, KintoAccountInfo } from "kinto-web-sdk";
import {
  encodeFunctionData,
  Address,
  getContract,
  defineChain,
  createPublicClient,
  http,
} from "viem";
import styled from "styled-components";
import AppHeader from "components/shared/AppHeader";
import AppFooter from "components/shared/AppFooter";
import {
  BaseScreen,
  BaseHeader,
  GlobalLoader,
  PrimaryButton,
} from "components/shared";
import "./App.css";

const USDC_ADDRESS = "0xcBcc3AF21CAE5Ba7a284bDe8a857b04190CcD29D";
const SRC_ADDRESS = "0x28B9786677F2261487494581a73EE724eD2db1f2";
const LDT_ADDRESS = "0x5AA66fEf2fFd6c59cB6630a186423a480a064906";

const MARKETPLACE_ADDRESS = "0x7FE6BA5ee1122DA581CC38a805796472613C214B";

const marketplaceAbi = [
  {
    inputs: [
      { internalType: "address", name: "token", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "buy",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "token", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "sell",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "token", type: "address" }],
    name: "getPrice",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

const erc20Abi = [
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
];

const kinto = defineChain({
  id: 7887,
  name: "Kinto",
  network: "kinto",
  nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" },
  rpcUrls: {
    default: {
      http: ["https://rpc.kinto-rpc.com/"],
      webSocket: ["wss://rpc.kinto.xyz/ws"],
    },
  },
  blockExplorers: {
    default: { name: "Explorer", url: "https://kintoscan.io" },
  },
});

const TokenMarketplace = () => {
  const [accountInfo, setAccountInfo] = useState<
    KintoAccountInfo | undefined
  >();
  const [isSelling, setIsSelling] = useState(false);
  const [selectedToken, setSelectedToken] = useState(SRC_ADDRESS);
  const [amount, setAmount] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("0");
  const [loading, setLoading] = useState(false);
  const [balances, setBalances] = useState<{ [key: string]: string }>({});
  const [needsApproval, setNeedsApproval] = useState(false);

  const kintoSDK = createKintoSDK(MARKETPLACE_ADDRESS);
  const client = createPublicClient({
    chain: kinto,
    transport: http(),
  });

  async function fetchBalances() {
    if (!accountInfo?.walletAddress) return;

    const tokens = [USDC_ADDRESS, SRC_ADDRESS, LDT_ADDRESS];
    const newBalances: { [key: string]: string } = {};

    for (const token of tokens) {
      const contract = getContract({
        address: token as Address,
        abi: erc20Abi,
        client: { public: client },
      });

      const balance = await contract.read.balanceOf([
        accountInfo.walletAddress,
      ]);
      newBalances[token] = (Number(balance) / 1e18).toFixed(4);
    }

    setBalances(newBalances);
  }

// ... previous code remains same until checkAllowance function

async function checkAllowance(token: string, amount: string) {
  if (!accountInfo?.walletAddress) return false;
  
  const tokenContract = getContract({
    address: token as Address,
    abi: [
      ...erc20Abi,
      {
        inputs: [
          { internalType: "address", name: "owner", type: "address" },
          { internalType: "address", name: "spender", type: "address" }
        ],
        name: "allowance",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      }
    ],
    client: { public: client },
  });

  try {
    const allowance = await tokenContract.read.allowance([
      accountInfo.walletAddress,
      MARKETPLACE_ADDRESS
    ]) as bigint;
    
    const amountWei = BigInt(parseFloat(amount) * 1e18);
    console.log('Allowance check:', {
      token,
      allowance: allowance.toString(),
      required: amountWei.toString()
    });
    
    // Simple comparison - if allowance >= required amount, we're good
    return allowance >= amountWei;
  } catch (error) {
    console.error('Error checking allowance:', error);
    return false;
  }
}

async function approve() {
  if (!amount || !accountInfo?.walletAddress) return;
  
  setLoading(true);
  try {
    const tokenToApprove = isSelling ? selectedToken : USDC_ADDRESS;
    // Approve a very large amount so we don't need to approve again
    const maxApproval = BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935"); // type(uint256).max
    
    await kintoSDK.sendTransaction([{
      to: tokenToApprove as Address,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [MARKETPLACE_ADDRESS, maxApproval],
      }),
      value: BigInt(0),
    }]);

    // After approval, check allowance again
    const hasAllowance = await checkAllowance(tokenToApprove, amount);
    setNeedsApproval(!hasAllowance);
  } catch (error) {
    console.error("Approval failed:", error);
  } finally {
    setLoading(false);
  }
}

// Less frequent allowance checks - only when amount or token changes
useEffect(() => {
  let timeoutId: NodeJS.Timeout;
  
  async function checkApprovalNeeded() {
    if (!amount || parseFloat(amount) <= 0) {
      setNeedsApproval(false);
      return;
    }
    
    const tokenToCheck = isSelling ? selectedToken : USDC_ADDRESS;
    // Add delay to prevent too frequent checks
    timeoutId = setTimeout(async () => {
      const hasAllowance = await checkAllowance(tokenToCheck, amount);
      setNeedsApproval(!hasAllowance);
    }, 500);
  }
  
  checkApprovalNeeded();
  return () => clearTimeout(timeoutId);
}, [amount, selectedToken, isSelling]);

  async function handleSwap() {
    if (!amount || !selectedToken || !accountInfo?.walletAddress) return;

    setLoading(true);
    try {
      const amountWei = BigInt(parseFloat(amount) * 1e18);

      if (isSelling) {
        await kintoSDK.sendTransaction([
          {
            to: MARKETPLACE_ADDRESS,
            data: encodeFunctionData({
              abi: marketplaceAbi,
              functionName: "sell",
              args: [selectedToken, amountWei],
            }),
            value: BigInt(0),
          },
        ]);
      } else {
        await kintoSDK.sendTransaction([
          {
            to: MARKETPLACE_ADDRESS,
            data: encodeFunctionData({
              abi: marketplaceAbi,
              functionName: "buy",
              args: [selectedToken, amountWei],
            }),
            value: BigInt(0),
          },
        ]);
      }

      await fetchBalances();
      setAmount("");
      setExpectedOutput("0");
      setNeedsApproval(false);
    } catch (error) {
      console.error("Swap failed:", error);
    } finally {
      setLoading(false);
    }
  }

  async function updateExpectedOutput() {
    if (!amount || !selectedToken) {
      setExpectedOutput("0");
      return;
    }

    const contract = getContract({
      address: MARKETPLACE_ADDRESS as Address,
      abi: marketplaceAbi,
      client: { public: client },
    });

    const price = await contract.read.getPrice([selectedToken]);
    const amountIn = parseFloat(amount);
    const output = (
      isSelling
        ? (amountIn * Number(price)) / 1e18
        : amountIn / (Number(price) / 1e18)
    ).toFixed(6);
    setExpectedOutput(output);
  }

  useEffect(() => {
    updateExpectedOutput();
  }, [amount, selectedToken, isSelling]);

  useEffect(() => {
    async function init() {
      try {
        const info = await kintoSDK.connect();
        setAccountInfo(info);
      } catch (error) {
        console.error("Failed to connect:", error);
      }
    }
    init();
  }, [kintoSDK]);

  useEffect(() => {
    if (accountInfo?.walletAddress) {
      fetchBalances();
    }
  }, [accountInfo]);

  // Check if approval is needed whenever amount/token/direction changes
  useEffect(() => {
    async function checkApprovalNeeded() {
      if (!amount || parseFloat(amount) <= 0) {
        setNeedsApproval(false);
        return;
      }

      const tokenToCheck = isSelling ? selectedToken : USDC_ADDRESS;
      const hasAllowance = await checkAllowance(tokenToCheck, amount);
      setNeedsApproval(!hasAllowance);
    }

    checkApprovalNeeded();
  }, [amount, selectedToken, isSelling, accountInfo]);

  return (
    <WholeWrapper>
      <AppWrapper>
        <ContentWrapper>
          <AppHeader />
          <BaseScreen>
            {accountInfo ? (
              <SwapCard>
                <BaseHeader title="Realty Swap" />
                <SwapContainer>
                  <TokenInput>
                    <InputHeader>
                      <span>You {isSelling ? "sell" : "pay"}</span>
                      <Balance>
                        Balance:{" "}
                        {balances[isSelling ? selectedToken : USDC_ADDRESS] ||
                          "0.0000"}
                      </Balance>
                    </InputHeader>
                    <InputField>
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.0"
                      />
                      <TokenSelect
                        value={isSelling ? selectedToken : USDC_ADDRESS}
                        onChange={(e) => setSelectedToken(e.target.value)}
                        disabled={!isSelling}
                      >
                        {isSelling ? (
                          <>
                            <option value={SRC_ADDRESS}>SRC</option>
                            <option value={LDT_ADDRESS}>LDT</option>
                          </>
                        ) : (
                          <option value={USDC_ADDRESS}>USDC</option>
                        )}
                      </TokenSelect>
                    </InputField>
                  </TokenInput>

                  <SwapButton onClick={() => setIsSelling(!isSelling)}>
                    <ArrowDown />
                  </SwapButton>

                  <TokenInput>
                    <InputHeader>
                      <span>You receive</span>
                      <Balance>
                        Balance:{" "}
                        {balances[isSelling ? USDC_ADDRESS : selectedToken] ||
                          "0.0000"}
                      </Balance>
                    </InputHeader>
                    <InputField>
                      <input
                        type="text"
                        value={expectedOutput}
                        readOnly
                        placeholder="0.0"
                      />
                      <TokenSelect
                        value={isSelling ? USDC_ADDRESS : selectedToken}
                        onChange={(e) => setSelectedToken(e.target.value)}
                        disabled={isSelling}
                      >
                        {!isSelling ? (
                          <>
                            <option value={SRC_ADDRESS}>SRC</option>
                            <option value={LDT_ADDRESS}>LDT</option>
                          </>
                        ) : (
                          <option value={USDC_ADDRESS}>USDC</option>
                        )}
                      </TokenSelect>
                    </InputField>
                  </TokenInput>
                </SwapContainer>

                <PrimaryButton
                  onClick={needsApproval ? approve : handleSwap}
                  disabled={loading || !amount || parseFloat(amount) <= 0}
                >
                  {loading
                    ? "Processing..."
                    : !amount
                    ? "Enter amount"
                    : needsApproval
                    ? `Approve ${
                        isSelling
                          ? selectedToken === SRC_ADDRESS
                            ? "SRC"
                            : "LDT"
                          : "USDC"
                      }`
                    : isSelling
                    ? "Sell"
                    : "Buy"}
                </PrimaryButton>
              </SwapCard>
            ) : (
              <GlobalLoader />
            )}
          </BaseScreen>
          <AppFooter />
        </ContentWrapper>
      </AppWrapper>
    </WholeWrapper>
  );
};

const SwapCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
  background: white;
  border-radius: 16px;
  padding: 24px;
  max-width: 480px;
  width: 100%;
  box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1);
`;

const SwapContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const TokenInput = styled.div`
  background: #f7f7f7;
  border-radius: 12px;
  padding: 16px;
`;

const InputHeader = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  color: #666;
  font-size: 14px;
`;

const Balance = styled.span`
  color: #999;
`;

const InputField = styled.div`
  display: flex;
  gap: 12px;

  input {
    flex: 1;
    background: none;
    border: none;
    font-size: 24px;
    outline: none;
    padding: 4px 0;

    &::placeholder {
      color: #999;
    }
  }
`;

const TokenSelect = styled.select`
  background: none;
  border: none;
  font-size: 18px;
  padding: 4px 8px;
  cursor: pointer;
  outline: none;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }
`;

const SwapButton = styled.button`
  background: none;
  border: none;
  margin: 8px auto;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #666;

  &:hover {
    color: #333;
  }
`;

const WholeWrapper = styled.div`
  flex-flow: column nowrap;
  height: auto;
  align-items: center;
  width: 100%;
  display: flex;
  min-height: 100vh;
  min-width: 100vw;
  position: relative;
`;

const AppWrapper = styled.div`
  flex-flow: column nowrap;
  height: auto;
  align-items: center;
  width: 100%;
  display: flex;
  min-height: 85vh;
  min-width: 100vw;

  @media only screen and (max-width: 400px) {
    min-height: 90vh;
  }
`;

const ContentWrapper = styled.div`
  display: flex;
  flex-flow: column nowrap;
  justify-content: flex-start;
  align-items: center;
  height: auto;
  min-height: 100vh;
  width: 100%;
  background: url(engen/commitment.svg) no-repeat;
  background-position-x: right;
  background-size: auto;
  overflow: hidden;
`;

const ArrowDown = styled.div`
  width: 24px;
  height: 24px;
  position: relative;

  &:before,
  &:after {
    content: "";
    position: absolute;
    background-color: currentColor;
    border-radius: 2px;
  }

  &:before {
    width: 2px;
    height: 16px;
    left: 11px;
    top: 0;
  }

  &:after {
    width: 12px;
    height: 12px;
    left: 6px;
    top: 11px;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: rotate(45deg);
    background: none;
  }
`;

function App() {
  return (
    <div className="App">
      <TokenMarketplace />
    </div>
  );
}

export default App;
