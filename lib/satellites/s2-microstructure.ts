/** S2: compose microstructure / flow narrative for MoE (CVD, netflow cues, liquidation proxy). */

export type S2MicroInput = {
  microstructureLine: string | null;
  leviathanLine: string | null;
  onchainMetricShift: string | null;
};

/** English block appended into microstructure_signal for experts. */
export function buildS2MicroSatelliteSummary(input: S2MicroInput): string {
  const chunks: string[] = ['S2 Micro satellite (order-flow & liquidity):'];
  if (input.microstructureLine?.trim()) {
    chunks.push(input.microstructureLine.trim());
  } else {
    chunks.push('CVD/entropy/Kalman: signal-core disabled or empty this cycle.');
  }
  if (input.leviathanLine?.trim()) {
    chunks.push(`Institutional netflow / Leviathan: ${input.leviathanLine.trim().slice(0, 500)}`);
  }
  if (input.onchainMetricShift?.trim()) {
    chunks.push(`On-chain metric shift: ${input.onchainMetricShift.trim().slice(0, 400)}`);
  }
  chunks.push(
    'Liquidation heatmap: use Psych expert funding + OI stress as proxy; dedicated Coinglass stream not configured.'
  );
  return chunks.join(' ');
}

