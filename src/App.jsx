import React, { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
  useConnection,
} from "@solana/wallet-adapter-react";
import {
  WalletModalProvider,
  WalletMultiButton,
} from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

function App() {
  const endpoint = clusterApiUrl("devnet"); // استخدم "mainnet-beta" للشبكة الرئيسية
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
            <h1 className="text-2xl font-bold mb-6">اتصال بمحفظة سولانا</h1>
            <WalletMultiButton className="!bg-purple-600 !px-6 !py-2 !rounded-2xl !text-white !shadow-lg" />
            <WalletInfo />
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function WalletInfo() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [balance, setBalance] = React.useState(null);

  React.useEffect(() => {
    if (publicKey) {
      (async () => {
        const bal = await connection.getBalance(publicKey);
        setBalance(bal / 1e9); // من lamports إلى SOL
      })();
    }
  }, [publicKey, connection]);

  if (!publicKey) return null;

  return (
    <div className="mt-6 p-4 bg-gray-800 rounded-xl shadow-md text-sm">
      <p>
        <strong>العنوان:</strong> {publicKey.toBase58()}
      </p>
      <p>
        <strong>الرصيد:</strong>{" "}
        {balance !== null ? `${balance} SOL` : "جارٍ التحميل..."}
      </p>
    </div>
  );
}

export default App;     
