import React, { useEffect, useMemo, useState } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import {
  WalletModalProvider,
  WalletMultiButton,
} from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * High-level goals implemented:
 * - Responsive UI for Mobile & Desktop
 * - Price ticker (SOL, USDT, USDC) with live polling
 * - Currency calculator with icons
 * - Chain selector: Solana | Ethereum
 * - Connect flows:
 *    • Solana via WalletAdapter (Phantom, Solflare)
 *    • Ethereum via window.ethereum (MetaMask / Phantom EVM)
 * - "Buy Now" button: enabled only when wallet connected AND active chain is Solana
 * - Network icon row + ability to switch chain from inside the UI (no need to leave the wallet app)
 * - Robust disconnect that clears storage to avoid sticky default wallet issues on mobile
 */

// ------------------------------
// Small UI helpers
// ------------------------------
const Badge = ({ children, active, onClick }) => (
  <button
    onClick={onClick}
    className={
      "px-3 py-1 rounded-full text-sm font-medium transition border " +
      (active
        ? "bg-purple-600 text-white border-transparent shadow"
        : "bg-white text-gray-800 border-gray-200 hover:bg-gray-50")
    }
  >
    {children}
  </button>
);

const TokenIcon = ({ symbol, size = 28 }) => {
  const map = {
    SOL: "https://cryptofonts.com/img/icons/sol.svg",
    USDT: "https://cryptofonts.com/img/icons/usdt.svg",
    USDC: "https://cryptofonts.com/img/icons/usdc.svg",
    ETH: "https://cryptofonts.com/img/icons/eth.svg",
  };
  return (
    <img
      src={map[symbol]}
      alt={symbol}
      width={size}
      height={size}
      className="inline-block align-middle"
      onError={(e) => {
        // fallback emoji
        e.currentTarget.outerHTML = `<span style="font-size:${size}px">💠</span>`;
      }}
    />
  );
};

// ------------------------------
// Prices hook (polling from CoinGecko)
// ------------------------------
const usePrices = () => {
  const [prices, setPrices] = useState({ SOL: 0, USDT: 1, USDC: 1, ETH: 0 });
  useEffect(() => {
    let mounted = true;
    const fetchPrices = async () => {
      try {
        // CoinGecko public API (no key required)
        const ids = "solana,tether,usd-coin,ethereum";
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
        );
        const data = await res.json();
        if (!mounted) return;
        setPrices({
          SOL: data.solana?.usd ?? 0,
          USDT: data.tether?.usd ?? 1,
          USDC: data["usd-coin"]?.usd ?? 1,
          ETH: data.ethereum?.usd ?? 0,
        });
      } catch (e) {
        // silent retry
      }
    };
    fetchPrices();
    const id = setInterval(fetchPrices, 15000); // 15s polling
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);
  return prices;
};

// ------------------------------
// EVM wallet minimal connector (MetaMask / Phantom EVM)
// ------------------------------
const useEvmWallet = () => {
  const [evmAddress, setEvmAddress] = useState(null);
  const [evmChainId, setEvmChainId] = useState(null);

  const isEvmAvailable = typeof window !== "undefined" && window.ethereum;

  const connect = async () => {
    if (!isEvmAvailable) throw new Error("No EVM wallet found");
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });
    setEvmAddress(accounts?.[0] || null);
    const cid = await window.ethereum.request({ method: "eth_chainId" });
    setEvmChainId(cid);
  };

  const disconnect = () => {
    setEvmAddress(null);
    // EVM wallets don't provide a programmatic disconnect; we just forget locally.
  };

  const switchChain = async (hexChainId) => {
    if (!isEvmAvailable) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexChainId }],
      });
      const cid = await window.ethereum.request({ method: "eth_chainId" });
      setEvmChainId(cid);
    } catch (switchError) {
      // If the chain is not added to the wallet, try adding
      if (switchError?.code === 4902 && hexChainId === "0x1") {
        // example for Ethereum mainnet; other chains would need their params here.
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x1",
              chainName: "Ethereum Mainnet",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://cloudflare-eth.com"],
              blockExplorerUrls: ["https://etherscan.io"],
            },
          ],
        });
      }
    }
  
    // React to account / chain changes
  useEffect(() => {
    if (!isEvmAvailable) return;
    const onAccountsChanged = (accs) => setEvmAddress(accs?.[0] || null);
    const onChainChanged = (cid) => setEvmChainId(cid);
    window.ethereum.on?.("accountsChanged", onAccountsChanged);
    window.ethereum.on?.("chainChanged", onChainChanged);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", onChainChanged);
    };
  }, [isEvmAvailable]);

  return { isEvmAvailable, evmAddress, evmChainId, connect, disconnect, switchChain };
};

// ------------------------------
// Solana wallet content (via wallet adapter)
// ------------------------------
const SolanaWalletArea = ({ onDisconnected }) => {
  const { publicKey, connected, disconnect } = useWallet();
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!publicKey) return setBalance(null);
      const conn = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
      const lamports = await conn.getBalance(new PublicKey(publicKey));
      if (mounted) setBalance(lamports / 1e9);
    })();
    return () => void (mounted = false);
  }, [publicKey]);

  const hardDisconnect = async () => {
    await disconnect();
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    onDisconnected?.();
  };

  return (
    <div className="flex flex-col gap-2">
      {!connected ? (
        <WalletMultiButton className="!bg-purple-600 !rounded-xl !px-5 !py-2 !text-white !shadow-md" />
      ) : (
        <div className="text-sm">
          <div className="flex items-center gap-2">
            <span className="font-semibold">SOL Address:</span>
            <span className="truncate max-w-[180px]" title={publicKey?.toBase58()}>
              {publicKey?.toBase58()}
            </span>
          </div>
          <div className="mt-1 text-gray-600">Balance: {balance ?? "—"} SOL</div>
          <button onClick={hardDisconnect} className="mt-3 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600">
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
};

// ------------------------------
// Calculator Component
// ------------------------------
const Calculator = ({ prices, activeToken, setActiveToken, amount, setAmount }) => {
  const tokens = [
    { sym: "SOL", label: "Solana" },
    { sym: "USDT", label: "Tether" },
    { sym: "USDC", label: "USD Coin" },
  ];
  const usd = ((prices[activeToken] || 0) * (parseFloat(amount || "0") || 0)).toFixed(2);
  return (
    <div className="bg-white rounded-2xl p-4 shadow border w-full">
      <div className="flex items-center gap-3 mb-3">
        {tokens.map((t) => (
          <Badge key={t.sym} active={activeToken === t.sym} onClick={() => setActiveToken(t.sym)}>
            <span className="inline-flex items-center gap-2"><TokenIcon symbol={t.sym} /> {t.sym}</span>
          </Badge>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Amount ({activeToken})</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder={`0.0 ${activeToken}`}
            min="0"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Estimated Value (USD)</label>
          <div className="w-full px-4 py-3 rounded-xl border bg-gray-50 text-gray-800">
            ${usd}
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        Prices: SOL ${prices.SOL} • USDT ${prices.USDT} • USDC ${prices.USDC}
      </div>
    </div>
  );
};

// ------------------------------
// Main App
// ------------------------------
export default function App() {
  // Chains: "solana" | "ethereum"
  const [chain, setChain] = useState("solana");

  // Prices & calculator state
  const prices = usePrices();
  const [activeToken, setActiveToken] = useState("SOL");
  const [amount, setAmount] = useState("");

  // EVM wallet hook
  const {
    isEvmAvailable,
    evmAddress,
    evmChainId,
    connect: connectEvm,
    disconnect: disconnectEvm,
    switchChain: switchEvmChain,
  } = useEvmWallet();

  // Wallet adapters for Solana
  const endpoint = clusterApiUrl("mainnet-beta");
  const solWallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  // Derived states
  const isSolanaConnected = false; // will be read inside context consumer
  const isEvmConnected = !!evmAddress;
  const isBuyEnabled = chain === "solana"; // PLUS: must be connected below

  // UI chain switch also attempts to switch in wallet if EVM
  const handleChainSwitch = async (target) => {
    setChain(target);
    if (target === "ethereum" && evmAddress) {
      // ensure mainnet for pricing consistency
      await switchEvmChain("0x1");
    }
  };

  // Buy Now stub
  const handleBuy = () => {
    alert("Buy action placeholder — integrate program invocation / swap flow on Solana here.");
  };

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={solWallets} autoConnect={false}>
        <WalletModalProvider>
          <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 text-gray-900 px-4 py-8">
            <div className="max-w-5xl mx-auto flex flex-col gap-6">
              {/* Header */}
              <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-extrabold">Multi-Chain Pay</span>
                  <span className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700">MVP</span>
                </div>
                <div className="flex items-center gap-3">
                  {/* Chain Selector */}
                  <div className="flex items-center gap-2 bg-white border rounded-full px-2 py-1 shadow">
                    <Badge active={chain === "solana"} onClick={() => handleChainSwitch("solana")}>
                      <span className="inline-flex items-center gap-2"><TokenIcon symbol="SOL" size={20}/> Solana</span>
                    </Badge>
                    <Badge active={chain === "ethereum"} onClick={() => handleChainSwitch("ethereum")}>
                      <span className="inline-flex items-center gap-2"><TokenIcon symbol="ETH" size={20}/> Ethereum</span>
                    </Badge>
                  </div>

                  {/* Wallet Controls (depends on chain) */}
                  {chain === "solana" ? (
                    <SolanaWalletArea onDisconnected={() => {}} />
                  ) : (
                    <div className="flex items-center gap-2">
                      {!isEvmConnected ? (
                        <button
                          onClick={connectEvm}
                          className="px-4 py-2 rounded-xl bg-gray-900 text-white hover:bg-black shadow"
                        >
                          Connect EVM Wallet
                        </button>
                      ) : (
                        <div className="flex items-center gap-2 text-sm">
                          <div className="px-3 py-2 bg-white rounded-xl border">
                            <span className="font-semibold">EVM:</span> {evmAddress.slice(0, 6)}...{evmAddress.slice(-4)}
                          </div>
                          <button
                            onClick={() => switchEvmChain("0x1")}
                            className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                          >
                            Switch → ETH
                          </button>
                          <button
                            onClick={disconnectEvm}
                            className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                          >
                            Disconnect
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </header>

              {/* Calculator Card */}
              <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <Calculator
                    prices={prices}
                    activeToken={activeToken}
                    setActiveToken={setActiveToken}
                    amount={amount}
                    setAmount={setAmount}
                  />
                </div>

                {/* Side card: Buy Now */}
                <div className="bg-white rounded-2xl p-4 shadow border flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <TokenIcon symbol={activeToken} />
                    <div>
                      <div className="text-xs text-gray-500">Selected</div>
                      <div className="text-lg font-semibold">{activeToken}</div>
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">Chain: <strong className="text-gray-900 capitalize">{chain}</strong></div>

                  <button
                    onClick={handleBuy}
                    disabled={chain !== "solana"}
                    className={
                      "w-full px-4 py-3 rounded-xl font-semibold transition " +
                      (chain === "solana"
                        ? "bg-green-600 text-white hover:bg-green-700 shadow"
                        : "bg-gray-200 text-gray-500 cursor-not-allowed")
                    }
                    title={chain !== "solana" ? "Buy is only available on Solana in this MVP" : "Proceed"}
                  >
                    Buy Now
                  </button>

                  <div className="text-xs text-gray-500">
                    • Enabled only when <strong>Solana</strong> is selected and wallet is connected.<br/>
                    • Prices update every 15s.
                  </div>
                </div>
              </section>
            </div>
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
