import ReactECharts from "echarts-for-react";
import { useTheme } from "~/context/ThemeContext";

interface BarChartProps {
  data: Record<string, unknown>[];
  title?: string;
  xKey: string;
  yKeys: { key: string; name: string; color?: string }[];
  height?: number;
  horizontal?: boolean;
}

export function BarChart({ data, title, xKey, yKeys, height = 350, horizontal = false }: BarChartProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const colors = [
    "hsl(245, 58%, 51%)",
    "hsl(270, 60%, 55%)",
    "hsl(200, 70%, 50%)",
    "hsl(150, 60%, 45%)",
    "hsl(30, 80%, 55%)",
  ];

  const categoryAxis = {
    type: "category" as const,
    data: data.map((d) => d[xKey]),
    axisLine: { lineStyle: { color: isDark ? "#374151" : "#d1d5db" } },
    axisLabel: { color: isDark ? "#9ca3af" : "#6b7280", fontSize: 11 },
  };

  const valueAxis = {
    type: "value" as const,
    splitLine: { lineStyle: { color: isDark ? "#1f2937" : "#f3f4f6" } },
    axisLabel: { color: isDark ? "#9ca3af" : "#6b7280", fontSize: 11 },
  };

  const option: Record<string, unknown> = {
    backgroundColor: "transparent",
    title: title
      ? {
          text: title,
          textStyle: { color: isDark ? "#e5e7eb" : "#1f2937", fontSize: 14, fontWeight: 500 },
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
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: yKeys.map((y, i) => ({
      name: y.name,
      type: "bar",
      data: data.map((d) => d[y.key]),
      barMaxWidth: 40,
      itemStyle: {
        color: y.color ?? colors[i % colors.length],
        borderRadius: [4, 4, 0, 0],
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
