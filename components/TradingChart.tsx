'use client';

import { useEffect, useRef, memo } from 'react';
import * as LightweightCharts from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';

export type TradingChartDataPoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type TradingChartProps = {
  data: TradingChartDataPoint[];
  /** Entry zone: single price or [low, high]. Plotted as horizontal line(s). */
  entry_zone?: number | [number, number];
  /** Take-profit price levels to plot. */
  take_profit_targets?: number[];
  /** Stop-loss level (single price line). */
  stop_loss_level?: number;
  height?: number;
  className?: string;
};

/**
 * TradingView Lightweight Charts wrapper. Renders only on client; safe unmount.
 * Memoized to avoid re-renders when parent state changes (e.g. simulation amount input).
 * Must be loaded with dynamic(..., { ssr: false }) to avoid hydration mismatch.
 */
function TradingChart({
  data,
  entry_zone,
  take_profit_targets = [],
  stop_loss_level,
  height = 320,
  className = '',
}: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current || !data.length) return;

    let chart: IChartApi | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let chartCleanup: (() => void) | null = null;
    let cancelled = false;

    const initChart = () => {
      if (cancelled || !containerRef.current) return;
      const container = containerRef.current;
      const clientWidth = container.clientWidth;
      const clientHeight = container.clientHeight;

      // Do not call createChart until container has non-zero dimensions (avoids width(-1) render errors)
      if (clientWidth === 0 || clientHeight === 0) {
        timeoutId = setTimeout(initChart, 50);
        return;
      }

      const el = container;
      const safeWidth = Math.max(1, clientWidth);
      const safeHeight = Math.max(200, clientHeight || 400);
      chart = LightweightCharts.createChart(el, {
        width: safeWidth,
        height: safeHeight,
        autoSize: true,
        layout: {
          background: { color: '#0f172a' },
          textColor: '#94a3b8',
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: 'rgba(51, 65, 85, 0.5)' },
          horzLines: { color: 'rgba(51, 65, 85, 0.5)' },
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          borderColor: 'rgba(51, 65, 85, 0.8)',
        },
        rightPriceScale: {
          borderColor: 'rgba(51, 65, 85, 0.8)',
          scaleMargins: { top: 0.14, bottom: 0.28 },
        },
        leftPriceScale: { visible: false },
      });

      const chartWithSeries = chart as IChartApi & {
        addCandlestickSeries?: (options: Record<string, unknown>) => {
          setData: (data: unknown[]) => void;
          createPriceLine: (opts: Record<string, unknown>) => unknown;
          removePriceLine: (line: unknown) => void;
        };
        addSeries?: (
          seriesType: unknown,
          options: Record<string, unknown>
        ) => {
          setData: (data: unknown[]) => void;
          createPriceLine: (opts: Record<string, unknown>) => unknown;
          removePriceLine: (line: unknown) => void;
        };
      };
      const seriesOptions = {
        upColor: '#10b981',
        downColor: '#ef4444',
        borderDownColor: '#ef4444',
        borderUpColor: '#10b981',
      };
      const candleSeries =
        typeof chartWithSeries.addCandlestickSeries === 'function'
          ? chartWithSeries.addCandlestickSeries(seriesOptions)
          : typeof chartWithSeries.addSeries === 'function'
            ? chartWithSeries.addSeries((LightweightCharts as { CandlestickSeries?: unknown }).CandlestickSeries, seriesOptions)
            : null;
      if (!candleSeries) {
        chart.remove();
        chart = null;
        return;
      }

      const year = new Date().getFullYear();
      const toTime = (t: string): string => {
        if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
        try {
          const d = new Date(`${t}, ${year}`);
          if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
        } catch {
          // ignore
        }
        return t;
      };
      const normalized = data.map((d) => ({
        time: toTime(d.time),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      })).filter((d) => Number.isFinite(d.close));

      if (normalized.length > 0) {
        candleSeries.setData(normalized);
      }

      const priceLines: ReturnType<typeof candleSeries.createPriceLine>[] = [];

      if (typeof entry_zone === 'number' && Number.isFinite(entry_zone)) {
        priceLines.push(candleSeries.createPriceLine({
          price: entry_zone,
          color: '#f59e0b',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'Entry',
        }));
      } else if (Array.isArray(entry_zone) && entry_zone.length >= 2) {
        const [low, high] = entry_zone;
        if (Number.isFinite(low)) {
          priceLines.push(candleSeries.createPriceLine({
            price: low,
            color: 'rgba(245, 158, 11, 0.7)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'Entry Low',
          }));
        }
        if (Number.isFinite(high)) {
          priceLines.push(candleSeries.createPriceLine({
            price: high,
            color: 'rgba(245, 158, 11, 0.7)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'Entry High',
          }));
        }
      }

      take_profit_targets.forEach((price, i) => {
        if (!Number.isFinite(price)) return;
        priceLines.push(candleSeries.createPriceLine({
          price,
          color: '#10b981',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `TP${take_profit_targets.length > 1 ? ` ${i + 1}` : ''}`,
        }));
      });

      if (typeof stop_loss_level === 'number' && Number.isFinite(stop_loss_level)) {
        priceLines.push(candleSeries.createPriceLine({
          price: stop_loss_level,
          color: '#ef4444',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'SL',
        }));
      }

      chart.timeScale().fitContent();
      chartRef.current = chart;

      const handleResize = () => {
        if (containerRef.current && chartRef.current) {
          const w = Math.max(1, containerRef.current.clientWidth);
          const h = Math.max(200, containerRef.current.clientHeight || 400);
          chartRef.current.applyOptions({ width: w, height: h });
        }
      };
      window.addEventListener('resize', handleResize);

      if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
        resizeObserver = new ResizeObserver(() => handleResize());
        resizeObserver.observe(containerRef.current);
      }

      chartCleanup = () => {
        if (resizeObserver && containerRef.current) {
          resizeObserver.disconnect();
          resizeObserver = undefined;
        }
        window.removeEventListener('resize', handleResize);
        priceLines.forEach((pl) => candleSeries.removePriceLine(pl));
        if (chart) {
          chart.remove();
          chart = null;
        }
        chartRef.current = null;
      };
    };

    initChart();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      chartCleanup?.();
    };
  }, [data, entry_zone, take_profit_targets, stop_loss_level, height]);

  const layoutMinH = Math.max(200, height || 280);

  if (!data.length) {
    return (
      <div
        className={`flex w-full h-full min-h-[200px] items-center justify-center bg-slate-900/50 rounded-xl ${className}`}
        style={{ minHeight: layoutMinH }}
      >
        <span className="text-zinc-500 text-sm">אין נתוני גרף</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`w-full h-full min-h-[200px] ${className || ''}`.trim()}
      style={{ minHeight: layoutMinH, position: 'relative' }}
    />
  );
}

export default memo(TradingChart);
