'use client'

import type { CSSProperties, ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const defaultColors = ['#078b81', '#4776c5', '#e09b39', '#9470bd', '#d56868']

export type ChartBaseProps = {
  title?: string
  height?: number
  colors?: string[]
  showLegend?: boolean
  showTooltip?: boolean
  showGrid?: boolean
  className?: string
  style?: CSSProperties
}

export type Coordinate = readonly [x: number | string, y: number]

export type LineGraphProps = ChartBaseProps & {
  data: readonly (readonly Coordinate[])[]
  seriesNames?: string[]
  xAxisName?: string
  yAxisName?: string
  xAxisDomain?: [number | 'auto', number | 'auto']
  yAxisDomain?: [number | 'auto', number | 'auto']
  curve?: 'linear' | 'monotone' | 'step'
  showDots?: boolean
  strokeWidth?: number
}

export type BarDatum =
  | readonly [category: string, value: number]
  | { category: string; [seriesKey: string]: number | string }

export type BarSeries = {
  key: string
  name?: string
  color?: string
}

export type BarGraphProps = ChartBaseProps & {
  data: readonly BarDatum[]
  series?: BarSeries[]
  xAxisName?: string
  yAxisName?: string
  yAxisDomain?: [number | 'auto', number | 'auto']
  layout?: 'grouped' | 'stacked'
  barSize?: number
  borderRadius?: number
  showValues?: boolean
}

export type PieDatum = {
  label: string
  value: number
  color?: string
}

export type PieGraphProps = ChartBaseProps & {
  data: readonly PieDatum[]
  innerRadius?: number | string
  outerRadius?: number | string
  showLabels?: boolean
  padAngle?: number
}

export type AnalyticsChartSpec =
  | ({ type: 'line' } & LineGraphProps)
  | ({ type: 'bar' } & BarGraphProps)
  | ({ type: 'pie' } & PieGraphProps)

function ChartFrame({
  title,
  height = 320,
  className,
  style,
  children,
}: ChartBaseProps & { children: ReactNode }) {
  return (
    <section
      aria-label={title ?? 'Analytics chart'}
      className={['analytics-chart', className].filter(Boolean).join(' ')}
      style={style}
    >
      {title && <h2 className="analytics-chart-title">{title}</h2>}
      <div className="analytics-chart-canvas" style={{ height }}>
        {children}
      </div>
    </section>
  )
}

export function LineGraph({
  data,
  seriesNames,
  xAxisName,
  yAxisName,
  xAxisDomain,
  yAxisDomain,
  curve = 'monotone',
  showDots = true,
  strokeWidth = 2,
  colors = defaultColors,
  showLegend = true,
  showTooltip = true,
  showGrid = true,
  ...frameProps
}: LineGraphProps) {
  const pointsByX = new Map<number | string, Record<string, number | string | null>>()
  const palette = colors.length > 0 ? colors : defaultColors
  const series = data.map((points, index) => ({
    key: `series_${index}`,
    name: seriesNames?.[index] ?? `Series ${index + 1}`,
    color: palette[index % palette.length],
    points,
  }))

  for (const item of series) {
    for (const [x, y] of item.points) {
      const row = pointsByX.get(x) ?? { x }
      row[item.key] = y
      pointsByX.set(x, row)
    }
  }

  const chartData = [...pointsByX.values()]
  const allNumericX = chartData.every((point) => typeof point.x === 'number')
  if (allNumericX) {
    chartData.sort((left, right) => Number(left.x) - Number(right.x))
  }

  return (
    <ChartFrame {...frameProps}>
      {yAxisName && (
        <div className="analytics-chart-y-axis-title">{yAxisName}</div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 12, right: 20, bottom: 48, left: 16 }}
        >
          {showGrid && <CartesianGrid stroke="#e8edf1" strokeDasharray="3 3" />}
          {showTooltip && <Tooltip />}
          {showLegend && (
            <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 12 }} />
          )}
          <XAxis
            allowDuplicatedCategory={false}
            dataKey="x"
            domain={xAxisDomain}
            name={xAxisName}
            padding={{ left: 12, right: 12 }}
            type={allNumericX ? 'number' : 'category'}
            label={
              xAxisName
                ? { value: xAxisName, position: 'insideBottom', offset: -28 }
                : undefined
            }
          />
          <YAxis domain={yAxisDomain} />
          {series.map((item) => (
            <Line
              activeDot={{ r: 5 }}
              connectNulls={false}
              dataKey={item.key}
              dot={showDots}
              key={item.key}
              name={item.name}
              stroke={item.color}
              strokeWidth={strokeWidth}
              type={curve}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

function isTupleDatum(item: BarDatum): item is readonly [string, number] {
  return Array.isArray(item)
}

export function BarGraph({
  data,
  series,
  xAxisName,
  yAxisName,
  yAxisDomain,
  layout = 'grouped',
  barSize,
  borderRadius = 3,
  showValues = true,
  colors = defaultColors,
  showLegend = true,
  showTooltip = true,
  showGrid = true,
  ...frameProps
}: BarGraphProps) {
  const palette = colors.length > 0 ? colors : defaultColors
  const chartData = data.map((item) =>
    isTupleDatum(item) ? { category: item[0], value: item[1] } : item,
  )
  const seriesList =
    series ??
    (data.some(isTupleDatum)
      ? [{ key: 'value', name: 'Value' }]
      : Object.keys(chartData[0] ?? {})
          .filter((key) => key !== 'category')
          .map((key) => ({ key, name: key })))

  return (
    <ChartFrame {...frameProps}>
      {yAxisName && (
        <div className="analytics-chart-y-axis-title">{yAxisName}</div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          barSize={barSize}
          barCategoryGap="20%"
          margin={{
            top: showValues ? 28 : 12,
            right: 20,
            bottom: 48,
            left: 16,
          }}
        >
          {showGrid && <CartesianGrid stroke="#e8edf1" strokeDasharray="3 3" vertical={false} />}
          {showTooltip && <Tooltip />}
          {showLegend && seriesList.length > 1 && <Legend />}
          <XAxis
            dataKey="category"
            label={
              xAxisName
                ? { value: xAxisName, position: 'insideBottom', offset: -28 }
                : undefined
            }
          />
          <YAxis domain={yAxisDomain} />
          {seriesList.map((item, index) => (
            <Bar
              dataKey={item.key}
              fill={item.color ?? palette[index % palette.length]}
              key={item.key}
              name={item.name ?? item.key}
              radius={[borderRadius, borderRadius, 0, 0]}
              stackId={layout === 'stacked' ? 'total' : undefined}
            >
              {showValues && (
                <LabelList
                  dataKey={item.key}
                  fill="#344054"
                  fontSize={11}
                  formatter={(value) =>
                    typeof value === 'number' ? value.toLocaleString() : value
                  }
                  position="top"
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

export function PieGraph({
  data,
  innerRadius = 0,
  outerRadius = '80%',
  showLabels = true,
  padAngle = 1,
  colors = defaultColors,
  showLegend = true,
  showTooltip = true,
  ...frameProps
}: PieGraphProps) {
  const palette = colors.length > 0 ? colors : defaultColors
  return (
    <ChartFrame {...frameProps}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          {showTooltip && <Tooltip />}
          {showLegend && <Legend />}
          <Pie
            data={data}
            dataKey="value"
            innerRadius={innerRadius}
            nameKey="label"
            outerRadius={outerRadius}
            paddingAngle={padAngle}
            label={
              showLabels
                ? ({ percent }) =>
                    typeof percent === 'number'
                      ? `${(percent * 100).toFixed(1)}%`
                      : ''
                : false
            }
          >
            {data.map((item, index) => (
              <Cell
                fill={item.color ?? palette[index % palette.length]}
                key={`${item.label}-${index}`}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

export function ChartRenderer({ spec }: { spec: AnalyticsChartSpec }) {
  switch (spec.type) {
    case 'line':
      return <LineGraph {...spec} />
    case 'bar':
      return <BarGraph {...spec} />
    case 'pie':
      return <PieGraph {...spec} />
  }
}
