import ReactECharts from "echarts-for-react";
import { useTheme } from "~/context/ThemeContext";

interface DonutChartProps {
  data: { name: string; value: number; color?: string }[];
  title?: string;
  height?: number;
}

export function DonutChart({ data, title, height = 350 }: DonutChartProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const colors = [
    "hsl(245, 58%, 51%)",
    "hsl(270, 60%, 55%)",
    "hsl(200, 70%, 50%)",
    "hsl(150, 60%, 45%)",
    "hsl(30, 80%, 55%)",
    "hsl(340, 65%, 50%)",
  ];

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
      trigger: "item",
      backgroundColor: isDark ? "#1f2937" : "#ffffff",
      borderColor: isDark ? "#374151" : "#e5e7eb",
      textStyle: { color: isDark ? "#e5e7eb" : "#1f2937" },
      formatter: "{b}: {c} ({d}%)",
    },
    legend: {
      bottom: 0,
      textStyle: { color: isDark ? "#9ca3af" : "#6b7280" },
    },
    color: data.map((d, i) => d.color ?? colors[i % colors.length]),
    series: [
      {
        type: "pie",
        radius: ["45%", "70%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: isDark ? "#111827" : "#ffffff", borderWidth: 2 },
        label: { show: false },
        emphasis: {
          label: {
            show: true,
            fontSize: 13,
            fontWeight: 600,
            color: isDark ? "#e5e7eb" : "#1f2937",
          },
        },
        data: data.map((d) => ({ name: d.name, value: d.value })),
      },
    ],
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
