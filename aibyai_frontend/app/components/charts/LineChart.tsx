import ReactECharts from "echarts-for-react";
import { useTheme } from "~/context/ThemeContext";

interface LineChartProps {
  data: Record<string, unknown>[];
  title?: string;
  xKey: string;
  yKeys: { key: string; name: string; color?: string }[];
  height?: number;
}

export function LineChart({ data, title, xKey, yKeys, height = 350 }: LineChartProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const colors = [
    "hsl(245, 58%, 51%)",
    "hsl(270, 60%, 55%)",
    "hsl(200, 70%, 50%)",
    "hsl(150, 60%, 45%)",
    "hsl(30, 80%, 55%)",
  ];

  const option: Record<string, unknown> = {
    backgroundColor: "transparent",
    title: title
      ? {
          text: title,
          textStyle: {
            color: isDark ? "#e5e7eb" : "#1f2937",
            fontSize: 14,
            fontWeight: 500,
          },
          left: 0,
        }
      : undefined,
    tooltip: {
      trigger: "axis",
      backgroundColor: isDark ? "#1f2937" : "#ffffff",
      borderColor: isDark ? "#374151" : "#e5e7eb",
      textStyle: { color: isDark ? "#e5e7eb" : "#1f2937" },
    },
    legend: {
      bottom: 0,
      textStyle: { color: isDark ? "#9ca3af" : "#6b7280" },
      data: yKeys.map((y) => y.name),
    },
    grid: { left: "3%", right: "4%", bottom: "12%", top: title ? "15%" : "8%", containLabel: true },
    xAxis: {
      type: "category",
      data: data.map((d) => d[xKey]),
      axisLine: { lineStyle: { color: isDark ? "#374151" : "#d1d5db" } },
      axisLabel: { color: isDark ? "#9ca3af" : "#6b7280", fontSize: 11 },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: isDark ? "#1f2937" : "#f3f4f6" } },
      axisLabel: { color: isDark ? "#9ca3af" : "#6b7280", fontSize: 11 },
    },
    series: yKeys.map((y, i) => ({
      name: y.name,
      type: "line",
      smooth: true,
      data: data.map((d) => d[y.key]),
      lineStyle: { color: y.color ?? colors[i % colors.length], width: 2 },
      itemStyle: { color: y.color ?? colors[i % colors.length] },
      areaStyle: {
        color: {
          type: "linear",
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: (y.color ?? colors[i % colors.length]) + "33" },
            { offset: 1, color: (y.color ?? colors[i % colors.length]) + "05" },
          ],
        },
      },
    })),
  };

  return (
    <ReactECharts
      option={option}
      style={{ height }}
      opts={{ renderer: "canvas" }}
      theme={isDark ? "dark" : undefined}
    />
  );
}
