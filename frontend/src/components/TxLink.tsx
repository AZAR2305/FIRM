import { EXPLORER_URL } from "@/lib/config";
import { shortAddress } from "@/lib/format";

export function TxLink({ hash }: { hash: string }) {
  return (
    <a className="mono text-xs" href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer">
      {shortAddress(hash)}
    </a>
  );
}

export function AddressLink({ address, label }: { address: string; label?: string }) {
  return (
    <a className="mono break-all text-xs" href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noreferrer" title={address}>
      {label ?? shortAddress(address)}
    </a>
  );
}
