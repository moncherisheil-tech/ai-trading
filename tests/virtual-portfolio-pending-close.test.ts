import { describe, expect, it } from 'vitest';
import {
  markVirtualTradePendingClose,
  reopenVirtualTradeAfterFailedSell,
} from '@/lib/db/virtual-portfolio';

describe('virtual portfolio TWAP sell lifecycle', () => {
  it('exports pending_close helpers used by execution-engine', () => {
    expect(typeof markVirtualTradePendingClose).toBe('function');
    expect(typeof reopenVirtualTradeAfterFailedSell).toBe('function');
  });
});
