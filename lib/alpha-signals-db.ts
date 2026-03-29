import type { AlphaSignalRecord } from '@prisma/client';
import { getPrisma } from '@/lib/prisma';

/** Client-safe DTO for dashboard and `/api/trading/signals`. */
export type AlphaSignalDTO = {
  id: string;
  symbol: string;
  timeframe: string;
  direction: string;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  winProbability: number;
  whaleConfirmation: boolean;
  rationaleHebrew: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function toNum(d: unknown): number {
  if (typeof d === 'number' && Number.isFinite(d)) return d;
  if (d && typeof d === 'object' && 'toNumber' in d && typeof (d as { toNumber: () => number }).toNumber === 'function') {
    return (d as { toNumber: () => number }).toNumber();
  }
  return Number(d);
}

export function alphaRecordToDTO(row: AlphaSignalRecord): AlphaSignalDTO {
  return {
    id: row.id,
    symbol: row.symbol,
    timeframe: row.timeframe,
    direction: row.direction,
    entryPrice: toNum(row.entryPrice),
    targetPrice: toNum(row.targetPrice),
    stopLoss: toNum(row.stopLoss),
    winProbability: row.winProbability,
    whaleConfirmation: row.whaleConfirmation,
    rationaleHebrew: row.rationaleHebrew,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getLatestActiveAlphaSignalsFromDb(take = 120): Promise<AlphaSignalDTO[]> {
  const prisma = getPrisma();
  if (!prisma) return [];
  const rows = await prisma.alphaSignalRecord.findMany({
    where: { status: 'Active' },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return rows.map(alphaRecordToDTO);
}
