import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";

// REPLACE THIS WITH YOUR OWN RPC URL
const RPC_URL = "";
const IX_DATA_CHUNK_SIZE = 32;

export async function dumpTransaction(
  transaction: Transaction | VersionedTransaction,
  index: number | null = null
): Promise<string> {
  if (isVersionedTransaction(transaction)) {
    return await dumpVersionedTransaction(transaction, index);
  } else {
    return dumpLegacyTransaction(transaction, index);
  }
}

function convertToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => {
    return (byte & 0xff).toString(16).padStart(2, "0");
  }).join("");
}

function isVersionedTransaction(
  transaction: Transaction | VersionedTransaction
): transaction is VersionedTransaction {
  return "version" in transaction;
}

function dumpLegacyTransaction(
  transaction: Transaction,
  index: number | null = null
): string {
  let lines: string[] = [];

  lines.push(`version: not versioned (legacy)`);

  transaction.instructions.forEach((ix, i) => {
    const prefix = index === null ? "" : `${index}.`;
    lines.push(`${prefix}${i}: ${ix.programId.toBase58()}`);

    lines.push(`  data`);
    for (let d = 0; d < ix.data.length; d += IX_DATA_CHUNK_SIZE) {
      const hex = convertToHex(ix.data.slice(d, d + IX_DATA_CHUNK_SIZE));
      lines.push(`    ${hex}`);
    }

    lines.push(`  keys`);
    ix.keys.forEach((key, k) => {
      const signer = key.isSigner ? "s" : "-";
      const writable = key.isWritable ? "w" : "-";
      const rws = `r${writable}${signer}`;
      lines.push(
        `    ${k.toString().padStart(2, "0")}: ${rws} ${key.pubkey.toBase58()}`
      );
    });

    lines.push("");
  });
  return lines.join("\n");
}

async function dumpVersionedTransaction(
  transaction: VersionedTransaction,
  index: number | null = null
): Promise<string> {
  const message = transaction.message;
  const isSigner = message.isAccountSigner.bind(message);
  const isWritable = message.isAccountWritable.bind(message);

  let lines: string[] = [];

  lines.push(`version: ${transaction.version}`);

  // if ALTs are used, we cannot know the loaded pubkeys without fetching them.
  // we would like to avoid fetching them, so we just ALT <ALT ADDRESS>[<INDEX>] notation.
  const staticKeys = message.staticAccountKeys.map((k) => k.toBase58());
  const writableKeys: string[] = [];
  const readonlyKeys: string[] = [];
  message.addressTableLookups.forEach((alt) => {
    const altKey = alt.accountKey.toBase58();
    alt.writableIndexes.forEach((i) =>
      writableKeys.push(`ALT ${altKey}[${i}]`)
    );
    alt.readonlyIndexes.forEach((i) =>
      readonlyKeys.push(`ALT ${altKey}[${i}]`)
    );
  });
  const keys = [...staticKeys, ...writableKeys, ...readonlyKeys];

  transaction.message.compiledInstructions.forEach((ix, i) => {
    const prefix = index === null ? "" : `${index}.`;
    lines.push(`${prefix}${i}: ${keys[ix.programIdIndex]}`);

    lines.push(`  data`);
    for (let d = 0; d < ix.data.length; d += IX_DATA_CHUNK_SIZE) {
      const hex = convertToHex(ix.data.slice(d, d + IX_DATA_CHUNK_SIZE));
      lines.push(`    ${hex}`);
    }

    lines.push(`  keys`);
    ix.accountKeyIndexes.forEach((keyIndex, k) => {
      const signer = isSigner(keyIndex) ? "s" : "-";
      const writable = isWritable(keyIndex) ? "w" : "-";
      const rws = `r${writable}${signer}`;
      lines.push(
        `    ${k.toString().padStart(2, "0")}: ${rws} ${keys[keyIndex]}`
      );
    });

    lines.push("");
  });

  if (RPC_URL.length > 0) {
    const connection = new Connection(RPC_URL);
    const latestBlockhash = await connection.getLatestBlockhash();
    transaction.message.recentBlockhash = latestBlockhash.blockhash;
    const result = await connection.simulateTransaction(transaction);
    console.log({ result });
    lines.push("");
    lines.push(...result.value.logs);
    lines.push("");

    if (result.value.err) {
      lines.push("Error");
      lines.push(JSON.stringify(result.value.err));
    }
  }

  return lines.join("\n");
}
