import { addressUrl, txUrl } from "@/lib/config";
import { shortAddress } from "@/lib/format";

/** A transaction hash that opens the block explorer. */
export function TxLink({ hash }: { hash: string }) {
  return (
    <a className="mono text-xs" href={txUrl(hash)} target="_blank" rel="noreferrer" title={hash}>
      {shortAddress(hash)}
    </a>
  );
}

/** "View on explorer" for a confirmed transaction: shown after every successful mint, approval and swap. */
export function ExplorerTxLink({ hash, label = "Transaction" }: { hash: string; label?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2" data-testid="explorer-link" data-hash={hash}>
      <span>{label}</span>
      <a className="mono text-xs" href={txUrl(hash)} target="_blank" rel="noreferrer" title={hash}>
        {shortAddress(hash)}
      </a>
      <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="text-xs">
        View on block explorer ↗
      </a>
    </span>
  );
}

export function AddressLink({ address, label }: { address: string; label?: string }) {
  return (
    <a className="mono break-all text-xs" href={addressUrl(address)} target="_blank" rel="noreferrer" title={address}>
      {label ?? shortAddress(address)}
    </a>
  );
}
