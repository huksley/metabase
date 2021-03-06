/* @flow */

import React, { Component, PropTypes } from "react";

import CardRenderer from "./CardRenderer.jsx";
import LegendHeader from "./LegendHeader.jsx";
import ChartTooltip from "./ChartTooltip.jsx";

import "./LineAreaBarChart.css";

import { isNumeric, isDate } from "metabase/lib/schema_metadata";
import {
    getChartTypeFromData,
    getFriendlyName
} from "metabase/visualizations/lib/utils";
import { addCSSRule } from "metabase/lib/dom";
import { formatValue } from "metabase/lib/formatting";

import { getSettings } from "metabase/visualizations/lib/settings";

import { MinRowsError, ChartSettingsError } from "metabase/visualizations/lib/errors";

import _ from "underscore";
import cx from "classnames";

const MAX_SERIES = 20;

const MUTE_STYLE = "opacity: 0.25;"
for (let i = 0; i < MAX_SERIES; i++) {
    addCSSRule(`.LineAreaBarChart.mute-${i} svg.stacked .stack._${i} .area`,       MUTE_STYLE);
    addCSSRule(`.LineAreaBarChart.mute-${i} svg.stacked .stack._${i} .line`,       MUTE_STYLE);
    addCSSRule(`.LineAreaBarChart.mute-${i} svg.stacked .stack._${i} .bar`,        MUTE_STYLE);
    addCSSRule(`.LineAreaBarChart.mute-${i} svg.stacked .dc-tooltip._${i} .dot`,   MUTE_STYLE);

    addCSSRule(`.LineAreaBarChart.mute-${i} svg:not(.stacked) .sub._${i} .bar`,    MUTE_STYLE);
    addCSSRule(`.LineAreaBarChart.mute-${i} svg:not(.stacked) .sub._${i} .line`,   MUTE_STYLE);
    addCSSRule(`.LineAreaBarChart.mute-${i} svg:not(.stacked) .sub._${i} .dot`,    MUTE_STYLE);
    addCSSRule(`.LineAreaBarChart.mute-${i} svg:not(.stacked) .sub._${i} .bubble`, MUTE_STYLE);

    // row charts don't support multiseries
    addCSSRule(`.LineAreaBarChart.mute-${i} svg:not(.stacked) .row`, MUTE_STYLE);
}

import type { VisualizationProps } from "metabase/visualizations";

export default class LineAreaBarChart extends Component<*, VisualizationProps, *> {
    static identifier: string;
    static renderer: (element: Element, props: VisualizationProps) => any;

    static noHeader = true;
    static supportsSeries = true;

    static minSize = { width: 4, height: 3 };

    static isSensible(cols, rows) {
        return getChartTypeFromData(cols, rows, false) != null;
    }

    static checkRenderable([{ data: { cols, rows} }], settings) {
        if (rows.length < 1) { throw new MinRowsError(1, rows.length); }
        const dimensions = (settings["graph.dimensions"] || []).filter(name => name);
        const metrics = (settings["graph.metrics"] || []).filter(name => name);
        if (dimensions.length < 1 || metrics.length < 1) {
            throw new ChartSettingsError("Which fields do you want to use for the X and Y axes?", "Data", "Choose fields");
        }
    }

    static seriesAreCompatible(initialSeries, newSeries) {
        let initialSettings = getSettings([initialSeries]);
        let newSettings = getSettings([newSeries]);

        let initialDimensions = getColumnsFromNames(initialSeries.data.cols, initialSettings["graph.dimensions"]);
        let newDimensions = getColumnsFromNames(newSeries.data.cols, newSettings["graph.dimensions"]);
        let newMetrics = getColumnsFromNames(newSeries.data.cols, newSettings["graph.metrics"]);

        // must have at least one dimension and one metric
        if (newDimensions.length === 0 || newMetrics.length === 0) {
            return false;
        }

        // all metrics must be numeric
        if (!_.all(newMetrics, isNumeric)) {
            return false;
        }

        // both or neither primary dimension must be dates
        if (isDate(initialDimensions[0]) !== isDate(newDimensions[0])) {
            return false;
        }

        // both or neither primary dimension must be numeric
        if (isNumeric(initialDimensions[0]) !== isNumeric(newDimensions[0])) {
            return false;
        }

        return true;
    }

    static transformSeries(series) {
        let newSeries = [].concat(...series.map((s, seriesIndex) => transformSingleSeries(s, series, seriesIndex)));
        if (_.isEqual(series, newSeries) || newSeries.length === 0) {
            return series;
        } else {
            return newSeries;
        }
    }

    static propTypes = {
        series: PropTypes.array.isRequired,
        actionButtons: PropTypes.node,
        showTitle: PropTypes.bool,
        isDashboard: PropTypes.bool
    };

    static defaultProps = {
    };

    getHoverClasses() {
        const { hovered } = this.props;
        if (hovered && hovered.index != null) {
            let seriesClasses = _.range(0, MAX_SERIES).filter(n => n !== hovered.index).map(n => "mute-"+n);
            let axisClasses =
                hovered.axisIndex === 0 ? "mute-yr" :
                hovered.axisIndex === 1 ? "mute-yl" :
                null;
            return seriesClasses.concat(axisClasses);
        } else {
            return null;
        }
    }

    getFidelity() {
        let fidelity = { x: 0, y: 0 };
        let size = this.props.gridSize ||  { width: Infinity, height: Infinity };
        if (size.width >= 5) {
            fidelity.x = 2;
        } else if (size.width >= 4) {
            fidelity.x = 1;
        }
        if (size.height >= 5) {
            fidelity.y = 2;
        } else if (size.height >= 4) {
            fidelity.y = 1;
        }

        return fidelity;
    }

    getSettings() {
        let fidelity = this.getFidelity();

        let settings = { ...this.props.settings };

        // no axis in < 1 fidelity
        if (fidelity.x < 1) {
            settings["graph.y_axis.axis_enabled"] = false;
        }
        if (fidelity.y < 1) {
            settings["graph.x_axis.axis_enabled"] = false;
        }

        // no labels in < 2 fidelity
        if (fidelity.x < 2) {
            settings["graph.y_axis.labels_enabled"] = false;
        }
        if (fidelity.y < 2) {
            settings["graph.x_axis.labels_enabled"] = false;
        }

        // smooth interpolation at smallest x/y fidelity
        if (fidelity.x === 0 && fidelity.y === 0) {
            settings["line.interpolate"] = "cardinal";
        }

        return settings;
    }

    render() {
        const { series, hovered, showTitle, actionButtons, linkToCard } = this.props;

        const settings = this.getSettings();

        let titleHeaderSeries, multiseriesHeaderSeries;

        let originalSeries = series._raw || series;
        let cardIds = _.uniq(originalSeries.map(s => s.card.id))

        if (showTitle && settings["card.title"]) {
            titleHeaderSeries = [{ card: {
                name: settings["card.title"],
                id: cardIds.length === 1 ? cardIds[0] : null
            }}];
        }

        if (series.length > 1) {
            multiseriesHeaderSeries = series;
        }

        return (
            <div className={cx("LineAreaBarChart flex flex-column p1", this.getHoverClasses(), this.props.className)}>
                { titleHeaderSeries ?
                    <LegendHeader
                        className="flex-no-shrink"
                        series={titleHeaderSeries}
                        description={settings["card.description"]}
                        actionButtons={actionButtons}
                        linkToCard={linkToCard}
                    />
                : null }
                { multiseriesHeaderSeries || (!titleHeaderSeries && actionButtons) ? // always show action buttons if we have them
                    <LegendHeader
                        className="flex-no-shrink"
                        series={multiseriesHeaderSeries}
                        settings={settings}
                        hovered={hovered}
                        onHoverChange={this.props.onHoverChange}
                        actionButtons={!titleHeaderSeries ? actionButtons : null}
                        linkToCard={linkToCard}
                    />
                : null }
                <CardRenderer
                    {...this.props}
                    series={series}
                    settings={settings}
                    className="renderer flex-full"
                    maxSeries={MAX_SERIES}
                    renderer={this.constructor.renderer}
                />
                <ChartTooltip series={series} hovered={hovered} />
            </div>
        );
    }
}

function getColumnsFromNames(cols, names) {
    if (!names) {
        return [];
    }
    return names.map(name => _.findWhere(cols, { name }));
}

function transformSingleSeries(s, series, seriesIndex) {
    const { card, data } = s;

    // HACK: prevents cards from being transformed too many times
    if (card._transformed) {
        return [s];
    }

    const { cols, rows } = data;
    const settings = getSettings([s]);

    const dimensions = settings["graph.dimensions"].filter(d => d != null);
    const metrics = settings["graph.metrics"].filter(d => d != null);
    const dimensionColumnIndexes = dimensions.map(dimensionName =>
        _.findIndex(cols, (col) => col.name === dimensionName)
    );
    const metricColumnIndexes = metrics.map(metricName =>
        _.findIndex(cols, (col) => col.name === metricName)
    );
    const bubbleColumnIndex = settings["scatter.bubble"] && _.findIndex(cols, (col) => col.name === settings["scatter.bubble"]);
    const extraColumnIndexes = bubbleColumnIndex && bubbleColumnIndex >= 0 ? [bubbleColumnIndex] : [];

    if (dimensions.length > 1) {
        const [dimensionColumnIndex, seriesColumnIndex] = dimensionColumnIndexes;
        const rowColumnIndexes = [dimensionColumnIndex].concat(metricColumnIndexes, extraColumnIndexes);

        const breakoutValues = [];
        const breakoutRowsByValue = new Map;

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];
            const seriesValue = row[seriesColumnIndex];

            let seriesRows = breakoutRowsByValue.get(seriesValue);
            if (!seriesRows) {
                breakoutRowsByValue.set(seriesValue, seriesRows = []);
                breakoutValues.push(seriesValue);
            }

            let newRow = rowColumnIndexes.map(columnIndex => row[columnIndex]);
            // $FlowFixMe: _origin not typed
            newRow._origin = { seriesIndex, rowIndex, row, cols };
            seriesRows.push(newRow);
        }

        return breakoutValues.map((breakoutValue) => ({
            card: {
                ...card,
                // if multiseries include the card title as well as the breakout value
                name: [
                    // show series title if it's multiseries
                    series.length > 1 && card.name,
                    // always show grouping value
                    formatValue(breakoutValue, cols[seriesColumnIndex])
                ].filter(n => n).join(": "),
                _transformed: true,
                _breakoutValue: breakoutValue,
                _breakoutColumn: cols[seriesColumnIndex]
            },
            data: {
                rows: breakoutRowsByValue.get(breakoutValue),
                cols: rowColumnIndexes.map(i => cols[i]),
                _rawCols: cols
            }
        }));
    } else {
        const dimensionColumnIndex = dimensionColumnIndexes[0];
        return metricColumnIndexes.map(metricColumnIndex => {
            const col = cols[metricColumnIndex];
            const rowColumnIndexes = [dimensionColumnIndex].concat(metricColumnIndex, extraColumnIndexes);
            return {
                card: {
                    ...card,
                    name: [
                        // show series title if it's multiseries
                        series.length > 1 && card.name,
                        // show column name if there are multiple metrics
                        metricColumnIndexes.length > 1 && getFriendlyName(col)
                    ].filter(n => n).join(": "),
                    _transformed: true,
                },
                data: {
                    rows: rows.map((row, rowIndex) => {
                        const newRow = rowColumnIndexes.map(i => row[i]);
                        // $FlowFixMe: _origin not typed
                        newRow._origin = { seriesIndex, rowIndex, row, cols };
                        return newRow;
                    }),
                    cols: rowColumnIndexes.map(i => cols[i]),
                    _rawCols: cols
                }
            };
        });
    }
}
