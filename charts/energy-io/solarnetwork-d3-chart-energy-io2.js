/**
 * @require d3 3.0
 * @require solarnetwork-d3 0.0.54
 * @require solarnetwork-d3-chart-base 1.0.0
 */

if ( sn === undefined ) {
	sn = { chart: {} };
} else if ( sn.chart === undefined ) {
	sn.chart = {};
}

/**
 * @typedef sn.chart.energyIOBarChartParameters
 * @type {sn.Configuration}
 * @property {number} [width=812] - desired width, in pixels, of the chart
 * @property {number} [height=300] - desired height, in pixels, of the chart
 * @property {number[]} [padding=[30, 0, 30, 30]] - padding to inset the chart by, in top, right, bottom, left order
 * @property {number} [transitionMs=600] - transition time
 * @property {string} [aggregate] - the aggregation type; one of 'Month' or 'Hour' or 'Day'
 * @property {number} [ruleOpacity] - the maximum opacity to render rules at, during transitions
 * @property {number} [vertRuleOpacity] - the maximum opacity to render rules at, during transitions
 * @property {string[]} [seasonColors] - array of color values for spring, summer, autumn, and winter
 * @property {sn.Configuration} excludeSources - the sources to exclude from the chart
 */

/**
 * An energy input and output chart designed to show consumption and generation data simultaneously.
 * 
 * You can use the {@code excludeSources} parameter to dynamically alter which sources are visible
 * in the chart. After changing the configuration call {@link sn.chart.energyIOBarChart#regenerate()}
 * to re-draw the chart.
 * 
 * Note that the global {@link sn.colorFn} function is used to map sources to colors, so that
 * must be set up previously.
 * 
 * @class
 * @param {string} containerSelector - the selector for the element to insert the chart into
 * @param {sn.chart.energyIOBarChartParameters} [chartConfig] - the chart parameters
 * @returns {sn.chart.energyIOBarChart}
 */
sn.chart.energyIOBarChart = function(containerSelector, chartConfig) {
	'use strict';
	
	// override defaults of parent
	if ( !(chartConfig && chartConfig.padding) ) {
		chartConfig.value('padding', [20, 0, 40, 30]);
	}
	
	var parent = sn.chart.baseGroupedStackChart(containerSelector, chartConfig),
		superDraw = sn.superMethod.call(parent, 'draw');
	var that = (function() {
		var	me = sn.util.copy(parent),
			prop;
		Object.defineProperty(me, 'version', {value : '1.0.0', enumerable : true, configurable : true});
		return me;
	}());
	parent.me = that;

	// Boolean, true for northern hemisphere seasons, false for southern.
	var northernHemisphere = undefined;
	
	// Array of string color values representing spring, summer, autumn, winter
	var seasonColors = undefined;
	
	// an ordinal x-axis scale, to render precise bars with
	var xBar = d3.scale.ordinal();
	
	// object keys define group IDs to treat as "negative" or consumption values, below the X axis
	var negativeGroupMap = { Consumption : true };
	
	// calculated drawing data
	var drawData = {};

	var svgAggBandGroup = parent.svgDataRoot.append("g")
		.attr("class", "agg-band")
		.attr("transform", "translate(0," +(parent.height + parent.padding[2] - 25) + ".5)"); // .5 for odd-width stroke
	
	var svgData = parent.svgDataRoot.append("g")
		.attr('class', 'data crisp');
	
	var svgSumLineGroup = parent.svgDataRoot.append("g")
		.attr('class', 'agg-sum');

	var svgAggGroup = parent.svgDataRoot.append("g")
		.attr('class', 'agg-gen');
		//.attr("transform", "translate(" + parent.padding[3] + ",15)");
	
	
	function groupFillFn(d, i, j) {
		return parent.fillColor.call(this, d[0][parent.internalPropName].groupId, d[0], i);
	}
	
	function seasonColorFn(d) {
		var seasonColors = (config.seasonColors || ['#5c8726', '#e9a712', '#762123', '#80a3b7']);
		var month = d.getUTCMonth();
		if ( month < 2 || month == 11 ) {
			return (northernHemisphere ? seasonColors[3] : seasonColors[1]);
		}
		if ( month < 5 ) {
			return (northernHemisphere ? seasonColors[0] : seasonColors[2]);
		}
		if ( month < 8 ) {
			return (northernHemisphere ? seasonColors[1] : seasonColors[3]);
		}
		return (northernHemisphere ? seasonColors[2] : seasonColors[0]);
	}
	
	function labelSeasonColors(d) {
		if ( parent.aggregate() === 'Month' ) {
			return seasonColor(d);
		}
		return null;
	}
	
	function computeDomainX() {
		var x = parent.x,
			aggregateType = parent.aggregate(),
			xDomain = x.domain(),
			buckets,
			end = xDomain[1]; // d3.time.X.range has an exclusive end date, so we must add 1
		if ( aggregateType === 'Month' ) {
			end = d3.time.month.utc.offset(end, 1); 
			buckets = d3.time.months.utc;
		} else if ( aggregateType === 'Day' ) {
			end = d3.time.day.utc.offset(end, 1); 
			buckets = d3.time.days.utc;
		} else {
			// assume 'Hour'
			end = d3.time.hour.utc.offset(end, 1); 
			buckets = d3.time.hours.utc;
		}
		buckets = buckets(xDomain[0], end);
		xBar.domain(buckets).rangeRoundBands(x.range(), 0.2); 
	}

	/**
	 * Return the x pixel coordinate for a given bar.
	 * 
	 * @param {Object} d the data element
	 * @param {Number} i the domain index
	 * @returns {Number} x pixel coordinate
	 */
	function valueX(d, i) {
		return xBar(d.date);
	}
	
	function valueXMidBar(d, i) {
		return (xBar(d.date) + (xBar.rangeBand() / 2));
	}
	
	function valueY(d) {
		return parent.y(d.y0 + d.y);
	}
	
	function heightY(d) {
		return parent.y(d.y0) - parent.y(d.y0 + d.y);
	}
	
	function axisXMidBarValue(d) { 
		return xBar(d) + (xBar.rangeBand() / 2); 
	}
	
	function axisXTickClassMajor(d) {
		var aggregateType = parent.aggregate();
		return (aggregateType === 'Day' && d.getUTCDate() === 1)
			|| (aggregateType === 'Hour' && d.getUTCHours() === 0)
			|| (aggregateType === 'Month' && d.getUTCMonth() === 0);
	}

	function drawAxisX() {
		var numTicks = 12,
			fx = parent.x.tickFormat(numTicks),
			ticks = parent.x.ticks(numTicks),
			transitionMs = parent.transitionMs();

		// Generate x-ticks, centered within bars
		var labels = parent.svgTickGroupX.selectAll('text').data(ticks, Object)
				.classed({
						major : axisXTickClassMajor
					});
		
		labels.transition().duration(transitionMs)
	  			.attr('x', axisXMidBarValue)
	  			.text(fx);
		
		labels.enter().append('text')
				.attr('dy', '-0.5em') // needed so descenders not cut off
				.style('opacity', 1e-6)
				.attr('x', axisXMidBarValue)
				.classed({
						major : axisXTickClassMajor
					})
			.transition().duration(transitionMs)
				.style('opacity', 1)
				.text(fx)
				.each('end', function() {
						// remove the opacity style
						d3.select(this).style('opacity', null);
					});
		
		labels.exit().transition().duration(transitionMs)
				.style('opacity', 1e-6)
				.remove();
	}
	
	/**
	 * A rollup function for d3.dest(), that aggregates the plot property value and 
	 * returns objects in the form <code>{ date : Date(..), y : Number, plus : Number, minus : Number }</code>.
	 */
	function nestRollupAggregateSum(array) {
		// Note: we don't use d3.sum here because we want to end up with a null value for "holes"
		var sum = null, plus = null, minus = null, 
			d, v, i, len = array.length, groupId, negate = false;
		for ( i = 0; i < len; i += 1 ) {
			d = array[i];
			v = d[parent.plotPropertyName];
			if ( v !== undefined ) {
				groupId = d[parent.internalPropName].groupId;
				negate = negativeGroupMap[groupId] === true;
				if ( negate ) {
					minus += v;
				} else {
					plus += v;
				}
			}
		}
		if ( plus !== null || minus !== null ) {
			sum = plus - minus;
		}
		return { date : array[0].date, y : sum, plus : plus, minus : minus };
	}
	
	function setupDrawData() {
		var groupedData = [],
			groupIds = parent.groupIds,
			maxPositiveY = 0,
			maxNegativeY = 0,
			sumLineData,
			timeAggregateData;

		// construct a 3D array of our data, to achieve a dataType/source/datum hierarchy;
		// also construct 2D array for sum line
		groupIds.forEach(function(groupId) {
			var groupLayer = parent.groupLayers[groupId];
			if ( groupLayer === undefined ) {
				groupedData.push([]);
			} else {
				groupedData.push(groupLayer.map(function(e) {
					var max = d3.max(e.values, function(d) {
						return (d.y + d.y0);
					});
					/*
					var negate = (negativeGroupMap[groupId] === true),
						max = 0,
						i,
						len,
						d,
						s;
					for ( i = 0, len = e.values.length; i < len; i += 1 ) {
						d = e.values[i];
						s = (d.y + d.y0);
						if ( s > max ) {
							max = s;
						}
						s = d[parent.plotPropertyName];
						if ( negate ) {
							s = -s;
						}
						if ( i >= sumLine.length ) {
							sumLine.push({date : d.date, y : s});
						} else {
							sumLine[i].y += s;
						}
					}
					*/
					if ( negativeGroupMap[groupId] === true ) {
						if ( max > maxNegativeY ) {
							maxNegativeY = max;
						}
					} else if ( max > maxPositiveY ) {
						maxPositiveY = max;
					}
					return e.values;
				}));
			}
		});
		
		var allData = d3.merge(d3.merge(groupedData)).concat(xBar.domain().map(function(e) {
			return { date : e };
		}));
		drawData.allData = allData;
		sumLineData = d3.nest()
			.key(function(d) { 
				return d.date.getTime();
			})
			.sortKeys(d3.ascending)
			.rollup(nestRollupAggregateSum)
			.entries(allData).map(function (e) {
				return e.values;
			});
			
		timeAggregateData = d3.nest()
			.key(function(d) {
				var aggregateType = parent.aggregate();
				var date;
				if ( aggregateType === 'Day' ) {
					// rollup to month
					date = d3.time.month.utc.floor(d.date);
				} else if ( aggregateType === 'Month' ) {
					// rollup to MIDDLE of seasonal quarters, e.g. Jan/Apr/Jul/Oct
					date = d3.time.month.utc.offset(d.date, -(d.date.getUTCMonth() - (d.date.getUTCMonth() % 3)));
				} else {
					date = d3.time.day.utc.floor(d.date);
				}
				return date.getTime();
			})
			.sortKeys(d3.ascending)
			.rollup(nestRollupAggregateSum)
			.entries(allData).map(function (e) {
				// map date to aggregate value
				e.values.date = new Date(Number(e.key));
				return e.values;
			});
			
		return {
			groupedData : groupedData, 
			sumLineData : sumLineData,
			maxPositiveY : maxPositiveY,
			maxNegativeY : maxNegativeY
		};
	}
	
	function draw() {
		var groupIds = parent.groupIds,
			transitionMs = parent.transitionMs(),
			groups,
			sources,
			bars,
			centerYLoc,
			yDomain = parent.y.domain();
			
		// calculate our bar metrics
		computeDomainX();
		
		drawData = setupDrawData();

		// adjust Y domain to include "negative" range
		yDomain[0] = -drawData.maxNegativeY;
		yDomain[1] = drawData.maxPositiveY;
		parent.y.domain(yDomain).nice();
		
		centerYLoc = parent.y(0);
		
		function dataTypeGroupTransformFn(d) {
			var yShift = 0;
			if ( d.length > 0 && d[0].length > 0 && negativeGroupMap[d[0][0][parent.internalPropName].groupId] ) {
				yShift = -(centerYLoc * 2);
				return ('scale(1, -1) translate(0,' + yShift +')');
			} else {
				return null;
			}
		}
		
		// we create groups for each data type, but don't destroy them, so we preserve DOM order
		// and maintain opacity levels for all stack layers within each data type
		groups = svgData.selectAll('g.dataType').data(drawData.groupedData, function(d, i) {
					return groupIds[i];
				});
		groups.transition().duration(transitionMs)
				.attr('transform', dataTypeGroupTransformFn);
		groups.enter().append('g')
				.attr('class', 'dataType')
				.attr('transform', dataTypeGroupTransformFn);
				
		// now add a group for each source within the data type, where we set the color so all
		// bars within the group inherit the same value
		sources = groups.selectAll('g.source').data(Object, function(d, i) {
				return d[0].sourceId;
			})
			.style('fill', groupFillFn);
			
		sources.enter().append('g')
				.attr('class', 'source')
				.style('fill', groupFillFn);
					
		sources.exit().transition().duration(transitionMs)
			.style('opacity', 1e-6)
			.remove();
		
		// now add actual bars for the datum in the source in the data type
		bars = sources.selectAll('rect').data(Object, function(d, i) {
			return d.date;
		});
		
		bars.transition().duration(transitionMs)
				.attr('x', valueX)
				.attr('y', valueY)
				.attr('height', heightY)
				.attr('width', xBar.rangeBand());
		
		bars.enter().append('rect')
				.attr('x', valueX)
				.attr('y', centerYLoc)
				.attr('height', 1e-6)
				.attr('width', xBar.rangeBand())
			.transition().duration(transitionMs)
				.attr('y', valueY)
				.attr('height', heightY);
		
		bars.exit().transition().duration(transitionMs)
				.style('opacity', 1e-6)
				.remove();
		
		drawSumLine(drawData.sumLineData);
		
		parent.drawAxisY();
		drawAxisX();
	};
	
	function drawSumLine(sumLineData) {
		var transitionMs = parent.transitionMs();
		
		function sumDefined(d) {
			return d.y !== null;
		}
		
		var svgLine = d3.svg.line()
			.x(valueXMidBar)
			.y(function(d) { return parent.y(d.y) - 0.5; })
			.interpolate("monotone")
			.defined(sumDefined);
		
		var sumLine = svgSumLineGroup.selectAll("path").data([sumLineData]);
		
		sumLine.transition().duration(transitionMs)
			.attr("d", svgLine);
		
		sumLine.enter().append("path")
				.attr("d", d3.svg.line()
						.x(valueXMidBar)
						.y(function() { return parent.y(0) - 0.5; })
						.interpolate("monotone")
						.defined(sumDefined))
			.transition().duration(transitionMs)
				.attr("d", svgLine);
				
		sumLine.exit().transition().duration(transitionMs)
				.style('opacity', 1e-6)
				.remove();
	}
	
	/**
	 * Toggle showing the sum line, or get the current setting.
	 * 
	 * @param {boolean} [value] <em>true</em> to show the sum line, <em>false</em> to hide it
	 * @returns when used as a getter, the current setting
	 * @memberOf sn.chart.energyIOBarChart
	 */
	that.showSumLine = function(value) {
		if ( !arguments.length ) return !svgSumLineGroup.classed('off');
		var transitionMs = parent.transitionMs();
		svgSumLineGroup
			.style("opacity", (value ? 1e-6 : 1))
			.classed('off', false)
		.transition().duration(transitionMs)
			.style("opacity", (value ? 1 : 1e-6))
			.each('end', function() {
				// remove the opacity style
				d3.select(this)
					.style("opacity", null)
					.classed('off', !value);
			});
		return that;
	};
	
	/**
	 * Toggle between nothern/southern hemisphere seasons, or get the current setting.
	 * 
	 * @param {boolean} [value] <em>true</em> for northern hemisphere seasons, <em>false</em> for sothern hemisphere
	 * @returns when used as a getter, the current setting
	 * @memberOf sn.chart.energyIOBarChart
	 */
	that.northernHemisphere = function(value) {
		if ( !arguments.length ) return northernHemisphere;
		if ( value === northernHemisphere ) {
			return;
		}
		var transitionMs = parent.transitionMs();
		northernHemisphere = (value === true);
		svgAggBandGroup.selectAll("line").transition().duration(transitionMs)
			.style('stroke', seasonColorFn);
		svgAggGroup.selectAll("text").transition().duration(transitionMs)
			.style("fill", labelSeasonColors);
		return that;
	};
	
	/**
	 * Get or set an array of group IDs to treat as negative group IDs, that appear below
	 * the X axis.
	 *
	 * @param {Array} [value] the array of group IDs to use
	 * @return {Array} when used as a getter, the list of group IDs currently used, otherwise this object
	 * @memberOf sn.chart.energyIOBarChart
	 */
	that.negativeGroupIds = function(value) {
		if ( !arguments.length ) {
			return (function() {
				var prop,
					result = [];
				for ( prop in negativeGroupMap ) {
					if ( negativeGroupMap.hasOwnProperty(prop) ) {
						result.pus(prop);
					}
				}
				return result;
			}());
		}
		negativeGroupMap = {};
		value.forEach(function(e) {
			negativeGroupMap[e] = true;
		});
		return that;
	};

	Object.defineProperty(parent, 'draw', {configurable : true, value : draw });
	
	return that;
};

sn.chart.energyIOBarChart_OLD = function(containerSelector, chartConfig) {
	var sources = undefined;
	var config = (chartConfig || new sn.Configuration());
	
	// default to container's width, if we can
	var containerWidth = sn.pixelWidth(containerSelector);
	
	var p = (config.padding || [20, 0, 40, 30]),
		w = (config.width || containerWidth || 812) - p[1] - p[3],
		h = (config.height || 300) - p[0] - p[2],
    	x = d3.time.scale.utc().range([0, w]),
    	xBar = d3.scale.ordinal(),
		y = d3.scale.linear().range([h, 0]),
		format = d3.time.format("%H");
	
	// String, one of supported SolarNet aggregate types: Month, Day, or Hour
	var aggregateType = undefined;
	
	var transitionMs = undefined;
	
	//var ruleOpacity = (parameters.ruleOpacity || 0.1);
	var vertRuleOpacity = undefined;
	
	// Array of string color values representing spring, summer, autumn, winter
	var seasonColors = undefined;
	
	// Boolean, true for northern hemisphere seasons, false for southern.
	var northernHemisphere = undefined;

	var svgRoot = undefined,
		svg = undefined,
		svgTickGroupX = undefined,
		aggGroup = undefined,
		svgAggBandGroup = undefined,
		svgSumLineGroup = undefined;
	
	// our layer data, and generator function
	var layerGenerator = undefined;
	var layers = undefined;
	var minY = 0;
	var dailyAggregateWh = undefined;
	var aggDisplayFormatter = d3.format(',d');
	
	var consumptionLayerCount = 0;

	// Set y-axis  unit label
	// setup display units in kWh if domain range > 1000
	var displayFactor = 1;
	var displayFormatter = d3.format(',d');

	function parseConfiguration() {
		that.aggregate(config.aggregate);
		transitionMs = (config.transitionMs || 600);
		vertRuleOpacity = (config.vertRuleOpacity || 0.05);
		seasonColors = (config.seasonColors || ['#5c8726', '#e9a712', '#762123', '#80a3b7']);
		northernHemisphere = (config.northernHemisphere === true ? true : false);
	}

	// create our SVG container structure now
	svgRoot = d3.select(containerSelector).select('svg');
	if ( svgRoot.empty() ) {
		svgRoot = d3.select(containerSelector).append('svg:svg')
			.attr('class', 'chart')
			.attr("width", w + p[1] + p[3])
			.attr("height", h + p[0] + p[2]);
	} else {
		svgRoot.selectAll('*').remove();
	}

	svgAggBandGroup = svgRoot.append("g")
		.attr("class", "agg-band")
		.attr("transform", "translate(" + p[3] + "," +(h + p[0] + p[2] - 25) + ".5)"); // .5 for odd-width stroke

	svgRoot.append("g")
		.attr("class", "agg-band-ticks")
		.attr("transform", "translate(" + p[3] + "," +(h + p[0] + p[2] - 21) + ")");

	svg = svgRoot.append("g")
		.attr('class', 'data')
		.attr("transform", "translate(" + p[3] + "," + p[0] + ")");
	
	svgSumLineGroup = svgRoot.append("g")
		.attr('class', 'agg-sum')
		.attr("transform", "translate(" + p[3] + "," + p[0] + ")");

	svgTickGroupX = svgRoot.append("g")
		.attr("class", "ticks")
		.attr("transform", "translate(" + p[3] +"," +(h + p[0] + p[2]) +")");
	
	svgRoot.append("g")
		.attr("class", "vertrule")
		.attr("transform", "translate(" + p[3] + "," + p[0] + ")");

	svgRoot.append("g")
		.attr("class", "rule")
		.attr("transform", "translate(0," + p[0] + ")");

	aggGroup = svgRoot.append("g")
		.attr('class', 'agg-gen')
		.attr("transform", "translate(" + p[3] + ",15)");
	
	function computeDomainX() {
		var buckets;
		// d3.time.X.range has an exclusive end date, so we must add 1
		var end = layers.domainX[1];
		if ( aggregateType === 'Month' ) {
			end = d3.time.month.utc.offset(end, 1); 
			buckets = d3.time.months.utc;
		} else if ( aggregateType === 'Day' ) {
			end = d3.time.day.utc.offset(end, 1); 
			buckets = d3.time.days.utc;
		} else {
			// assume 'Hour'
			end = d3.time.hour.utc.offset(end, 1); 
			buckets = d3.time.hours.utc;
		}
		x.domain(layers.domainX);
		buckets = buckets(layers.domainX[0], end);
		xBar.domain(buckets).rangeRoundBands(x.range(), 0.2); 
	}

	function computeDomainY() {
		y.domain([minY, layers.maxY]).nice();
		computeUnitsY();
	}
	
	function computeUnitsY() {
		var fmt;
		var aggFmt;
		var maxY = d3.max(y.domain() ,function(v) { return Math.abs(v); });
		if ( maxY >= 1000000 ) {
			displayFactor = 1000000;
			fmt = ',g';
			aggFmt = ',.2f';
		} else if ( maxY >= 1000 ) {
			displayFactor = 1000;
			fmt = ',g';
			aggFmt = ',.1f';
		} else {
			displayFactor = 1;
			fmt = ',d';
			aggFmt = ',d';
		}
		displayFormatter = d3.format(fmt);
		aggDisplayFormatter = d3.format(aggFmt);
	}
	
	function displayFormat(d) {
		return displayFormatter(d / displayFactor);
	}

	function aggDisplayFormat(d) {
		return aggDisplayFormatter(d / displayFactor);
	}

	// Create daily aggregated data, in form [ { date: Date(2011-12-02 12:00), wattHoursTotal: 12312 }, ... ]
	function calculateAggregateWh() {
		var results = [];
		var i, j, len;
		var startIndex = undefined;
		var endIndex = layers[0].length;
		var currDayData = undefined;
		var obj = undefined;
		var domain = x.domain();
		
		// sum up values for each aggregate range
		len = layers.length;
		OUTER: for ( i = 0; i < endIndex; i++ ) {
			if ( startIndex !== undefined && i < startIndex ) {
				// skip before first full aggregate range
				continue;
			}
			for ( j = 0; j < len; j++ ) {
				if ( sn.runtime.excludeSources[layers[j].source] !== undefined ) {
					continue;
				}
				obj = layers[j][i];
				if ( startIndex === undefined ) {
					// we only want to sum for full ranges; e.g. for Hour aggregation if our domain starts at noon, 
					// we don't start aggregating values until we find the first midnight value
					if ( (aggregateType === 'Hour' && obj.x.getUTCHours() === 0)
							|| (aggregateType === 'Day' && obj.x.getUTCDate() === 1)
							|| (aggregateType === 'Month' && (obj.x.getUTCMonth() % 3) === 2) ) {
						startIndex = i;
					} else {
						continue OUTER;
					}
				}
				if ( currDayData === undefined 
						|| (aggregateType === 'Hour' && obj.x.getUTCDate() !== currDayData.date.getUTCDate())
						|| (aggregateType !== 'Month' && obj.x.getUTCMonth() !== currDayData.date.getUTCMonth()) 
						|| (aggregateType !== 'Month' && obj.x.getUTCFullYear() !== currDayData.date.getUTCFullYear())
						|| (aggregateType === 'Month' && (obj.x.getUTCMonth() % 3) === 2 && obj.x.getTime() >= d3.time.month.utc.offset(currDayData.date, 3).getTime()) ) {
					currDayData = {
							date : new Date(obj.x.getTime()), 
							wattHoursTotal : 0,
							wattHoursConsumed : 0,
							wattHoursGenerated : 0
						};
					currDayData.date.setUTCHours(0, 0, 0, 0);
					results.push(currDayData);
					
					// also add key for data's time in returned array, for fast lookup
					results[currDayData.date.getTime()] = currDayData;
				}
				if ( i >= startIndex ) {
					if ( j < consumptionLayerCount ) {
						currDayData.wattHoursConsumed += obj.y;
						currDayData.wattHoursTotal -= obj.y;
					} else {
						currDayData.wattHoursGenerated += obj.y;
						currDayData.wattHoursTotal += obj.y;
					}
				}
			}
		}
		
		return results;
	}
	
	function setup(rawData) {
		// turn filteredData object into proper array, sorted by date
		sources = [];
		var dataArray = sn.powerPerSourceArray(rawData, sources);

		// Transpose the data into watt layers by source, e.g.
		// [ [{x:0,y:0,y0:0},{x:1,y:1,y0:0}...], ... ]
		layerGenerator = sn.powerPerSourceStackedLayerGenerator(sources, 'wattHours')
			.excludeSources(config.excludeSources)
			.offset(function(data) {
				minY = 0;
				var i, j = -1,
					m = data[0].length,
					offset,
					y0 = [];
				while (++j < m) {
					i = -1;
					offset = 0;
					while ( ++i < consumptionLayerCount ) {
						offset -= data[i][j][1];
					}
					y0[j] = offset;
					if ( offset < minY ) {
						minY = offset;
					}
				}
				return y0;
			}).data(dataArray);
		layers = layerGenerator();

		// Compute the x-domain (by date) and y-domain (by top).
		computeDomainX();
		computeDomainY();
	}
	
	function axisYTransform(d) {
		// align to half-pixels, to 1px line is aligned to pixels and crisp
		return "translate(0," + (Math.round(y(d) + 0.5) - 0.5) + ")"; 
	}

	function axisXMidBarValue(d) { 
		return xBar(d) + (xBar.rangeBand() / 2); 
	}
	
	function axisXAggObject(d, propName) {
		var t = new Date(d.getTime());
		if ( aggregateType === 'Month' ) {
			t = d3.time.month.utc.floor(d);
			t = d3.time.month.utc.offset(t, -((t.getUTCMonth() + 1) % 3));
		} if ( aggregateType === 'Day' ) {
			t = d3.time.month.utc.floor(d);
		}
		t.setUTCHours(0, 0, 0, 0); // truncate to midnight of day
		return dailyAggregateWh[t.getTime()];
	}
	
	function axisXAggValue(d, propName) {
		var a = axisXAggObject(d, propName);
		var v = (a !== undefined ? Number(a[propName]) : undefined);
		if ( isNaN(v) ) {
			return 0;
		}
		return v;
	}
	
	function axisXAggTextFn(d, propName) {
		var a = axisXAggObject(d, propName);
		return (a === undefined ? '' : aggDisplayFormat(a[propName]));
	}
	
	function axisXAggSumTextFn(d) {
		return axisXAggTextFn(d, 'wattHoursTotal');
	}
	
	function axisXAggGenerationTextFn(d) {
		return axisXAggTextFn(d, 'wattHoursGenerated');
	}
	
	function labelSeasonColors(d) {
		if ( aggregateType === 'Month' ) {
			return seasonColor(d);
		}
		return null;
	}
	
	function adjustAxisXAggregateGeneration(aggTicks) {
		var aggLabels = aggGroup.selectAll("text").data(aggTicks, Object);
		
		aggLabels.transition().duration(transitionMs)
				.attr("x", axisXMidBarValue)
				.text(axisXAggGenerationTextFn)
				.style("fill", labelSeasonColors);
			
		aggLabels.enter().append("text")
				.attr("x", axisXMidBarValue)
				.style("opacity", 1e-6)
				.style("fill", labelSeasonColors)
			.transition().duration(transitionMs)
				.text(axisXAggGenerationTextFn)
				.style("opacity", 1)
				.each('end', function() {
					// remove the opacity style
					d3.select(this).style("opacity", null);
				});

		aggLabels.exit().transition().duration(transitionMs)
			.style("opacity", 1e-6)
			.remove();
	}
	
	/**
	 * Return an array of dates on the 1st and 15th day of each month within a given domain.
	 * 
	 * @param {Array} domain - at least 2 dates representing the start and end
	 * @return {Array} array of Date objects
	 */
	function firstAndMidMonthDates(domain) {
		var end = domain[domain.length - 1].getTime();
		var day = d3.time.month.utc.ceil(domain[0]);
		var result = [];
		while ( day.getTime() < end ) {
			result.push(day);
			if ( day.getUTCDate() === 1 ) {
				day = d3.time.day.utc.offset(day, 14);
			} else {
				day = d3.time.month.utc.ceil(day);
			}
		}
		return result;
	}

	function solarQuarterDates(domain) {
		var end = domain[domain.length - 1].getTime();
		var month = d3.time.month.utc.ceil(domain[0]);
		var result = [];
		while ( month.getTime() <= end ) {
			if ( result.length === 0 ) {
				// round up to nearest quarter...
				month = d3.time.month.utc.offset(month, Math.ceil(month.getUTCMonth() / 3) * 3 - month.getUTCMonth()); // not month + 1 because here we want Jan
			}
			result.push(month);
			month = d3.time.month.utc.offset(month, 3);
		}
		return result;
	}

	function tickClassAgg(d) {
		return (aggregateType === 'Day' && d.getUTCDate() === 15)
			|| (aggregateType === 'Hour' && d.getUTCHours() === 12)
			|| (aggregateType === 'Month' && d.getUTCMonth() % 3 === 1);
	}
	
	function tickClassNeg(d) {
		return (tickClassAgg(d) && axisXAggValue(d, 'wattHoursTotal') < 0);
	}

	function seasonColor(d) {
		var month = d.getUTCMonth();
		if ( month < 2 || month == 11 ) {
			return (northernHemisphere ? seasonColors[3] : seasonColors[1]);
		}
		if ( month < 5 ) {
			return (northernHemisphere ? seasonColors[0] : seasonColors[2]);
		}
		if ( month < 8 ) {
			return (northernHemisphere ? seasonColors[1] : seasonColors[3]);
		}
		return (northernHemisphere ? seasonColors[2] : seasonColors[0]);
	}
	
	function axisXVertRule(d) {
			return (xBar(d) + 0.5);
	}
	
	function adjustAxisX() {
		if ( d3.event && d3.event.transform ) {
			d3.event.transform(x);
		}
		var ticks;
		var aggTicks = [];
		var aggVertRuleTicks = [];
		var aggBandTicks = [];
		var e, i, len, date;
		if ( aggregateType === 'Month' ) {
			ticks = solarQuarterDates(x.domain());
			if ( ticks.length > 0 && x.domain()[0].getUTCMonth() % 3 !== 0 ) {
				// insert a tick for the band to show the first partial season
				aggBandTicks.push(x.domain()[0]);
			}
			// ticks are on Jan, Apr, Jul, Oct
			for ( i = 0, len = ticks.length; i < len; i++ ) {
				e = ticks[i];
				date = d3.time.month.utc.offset(e, -1);
				if ( date.getTime() < x.domain()[0].getTime() ) {
					date = x.domain()[0];
				}
				aggBandTicks.push(date);
			}
			if ( ticks.length > 0 && x.domain()[1].getUTCMonth() % 3 !== 0 ) {
				// insert a tick for the band to show the last partial season
				aggBandTicks.push(x.domain()[1]);
			}
			aggTicks = ticks;
		} else if ( aggregateType === 'Day' ) {
			ticks = firstAndMidMonthDates(x.domain());
			// agg ticks shifted by 14 days so centered within the month
			for ( i = 0, len = ticks.length; i < len; i++ ) {
				e = ticks[i];
				if ( e.getUTCDate() === 15 ) {
					aggTicks.push(e);
				} else if ( e.getUTCDate() === 1 ) {
					aggVertRuleTicks.push(e);
				}
			}
		} else {
			// assume aggregateType == Hour
			ticks = x.ticks(d3.time.hours.utc, 12);
			
			for ( i = 0, len = ticks.length; i < len; i++ ) {
				e = ticks[i];
				if ( e.getUTCHours() === 12 ) {
					aggTicks.push(e);
				} else if ( e.getUTCHours() === 0 ) {
					aggVertRuleTicks.push(e);
				}
			}
		}
		dailyAggregateWh = calculateAggregateWh();

		adjustAxisXTicks(ticks);
		adjustAxisXRules(aggVertRuleTicks);
		adjustAxisXAggregateBands(aggBandTicks, ticks);
		adjustAxisXAggregateGeneration(aggTicks);
	}
	
	function adjustAxisXTicks(ticks) {
		var fx = x.tickFormat(ticks.length);
		
		function tickText(d) {
			if ( tickClassAgg(d) ) {
				return axisXAggSumTextFn(d);
			} else {
				return fx(d);
			}
		}

		// Add date labels, centered within associated band
		var labels = svgTickGroupX.selectAll("text").data(ticks, Object)
			.classed({
				agg : tickClassAgg,
				neg : tickClassNeg
			});

		labels.transition().duration(transitionMs)
		  	.attr("x", axisXMidBarValue)
		  	.text(tickText);
		
		labels.enter().append("text")
			.attr("dy", "-0.5em") // needed so descenders not cut off
			.style("opacity", 1e-6)
			.attr("x", axisXMidBarValue)
			.classed({
				agg : tickClassAgg,
				neg : tickClassNeg
			})
		.transition().duration(transitionMs)
				.style("opacity", 1)
				.text(tickText)
				.each('end', function() {
						// remove the opacity style
						d3.select(this).style("opacity", null);
					});
		
		labels.exit().transition().duration(transitionMs)
			.style("opacity", 1e-6)
			.remove();
	}
	
	function adjustAxisXRules(aggVertRuleTicks) {
		var axisLines = svgRoot.select("g.vertrule").selectAll("line").data(aggVertRuleTicks, Object);
		axisLines.transition().duration(transitionMs)
	  		.attr("x1", axisXVertRule)
	  		.attr("x2", axisXVertRule);
		
		axisLines.enter().append("line")
			.style("opacity", 1e-6)
			.attr("x1", axisXVertRule)
	  		.attr("x2", axisXVertRule)
	  		.attr("y1", 0)
	  		.attr("y2", h + 10)
		.transition().duration(transitionMs)
			.style("opacity", vertRuleOpacity)
			.each('end', function() {
				// remove the opacity style
				d3.select(this).style("opacity", null);
			});
		
		axisLines.exit().transition().duration(transitionMs)
			.style("opacity", 1e-6)
			.remove();
	}
	
	function adjustAxisXAggregateBands(bandTicks, labelTicks) {
		var barWidth = xBar.rangeBand();
		var barSpacing = (xBar.domain().length > 1 
			? (xBar(xBar.domain()[1]) - xBar(xBar.domain()[0])) 
			: barWidth);
		var barPadding = (barSpacing - barWidth) / 2;
		var aggBands = svgRoot.select("g.agg-band").selectAll("line").data(bandTicks, Object);
		var bandPosition = function(s) {
				s.attr("x1", function(d) {
					return xBar(d) - barPadding;
				})
				.attr("x2", function(d, i) {
					// for all bands but last, set to start of next band
					if ( i + 1 < bandTicks.length ) {
						return xBar(bandTicks[i+1]) - barPadding;
					}
					// for last band, set to end of last bar
					if ( bandTicks.length > 1 ) {
						return (xBar(x.domain()[1]) + barWidth + barPadding);
					}
					return xBar(d) + barPadding;
				})
				.style('stroke', seasonColor);
		};
		aggBands.transition().duration(transitionMs)
			.call(bandPosition);

		aggBands.enter().append("line")
			.style("opacity", 1e-6)
			.call(bandPosition)
		.transition().duration(transitionMs)
			.style("opacity", 1)
			.each('end', function() {
				// remove the opacity style
				d3.select(this).style("opacity", null);
			});

		aggBands.exit().transition().duration(transitionMs)
			.style("opacity", 1e-6)
			.remove();
		
		var aggBandLabels = svgRoot.select("g.agg-band-ticks").selectAll("text").data(labelTicks, Object);
		aggBandLabels.transition().duration(transitionMs)
		  	.attr("x", axisXMidBarValue)
		  	.text(axisXAggSumTextFn);
		
		aggBandLabels.enter().append("text")
			.style("opacity", 1e-6)
			.attr("x", axisXMidBarValue)
		.transition().duration(transitionMs)
				.style("opacity", 1)
				.text(axisXAggSumTextFn)
				.each('end', function() {
						// remove the opacity style
						d3.select(this).style("opacity", null);
					});
		
		aggBandLabels.exit().transition().duration(transitionMs)
			.style("opacity", 1e-6)
			.remove();
	}

	function adjustAxisY() {
		function ruleClass(d) {
			return (d === 0 ? 'origin' : 'm');
		}
		
		var axisLines = svgRoot.select("g.rule").selectAll("g").data(y.ticks(5));
		var axisLinesT = axisLines.transition().duration(transitionMs);
		axisLinesT.attr("transform", axisYTransform)
			.select("text")
				.text(displayFormat);
		axisLinesT.select("line")
				.attr('class', ruleClass);
		
	  	axisLines.exit().transition().duration(transitionMs)
	  			.style("opacity", 1e-6)
	  			.remove();
	  			
		var entered = axisLines.enter()
				.append("g")
				.style("opacity", 1e-6)
	  			.attr("transform", axisYTransform);
		entered.append("line")
				.attr("x2", w + p[3])
				.attr('x1', p[3])
				.attr('class', ruleClass);
		entered.append("text")
				.attr("x", p[3] - 10)
				.text(displayFormat);
		entered.transition().duration(transitionMs)
			.style("opacity", null);
	}
	
	/**
	 * Return the x pixel coordinate for a given bar.
	 * 
	 * @param {Object} d the data element
	 * @param {Number} i the domain index
	 * @returns {Number} x pixel coordinate
	 */
	function valueX(d, i) {
		return xBar(d.x);
	}
	
	function valueXMidBar(d, i) {
		return (xBar(d.x) + (xBar.rangeBand() / 2));
	}
	
	function redraw() {
		// Add a group for each source.
		var sourceGroups = svg.selectAll("g.source").data(layers)
			.style("fill", sn.colorFn);
		sourceGroups.enter()
			.append("g")
				.attr("class", "source")
				.style("fill", sn.colorFn);
		sourceGroups.exit().remove();
		
		var centerYLoc = y(0);
		
		function valueY(d) {
			return y(d.y0 + d.y);
		}
		
		function heightY(d) {
			return y(d.y0) - y(d.y0 + d.y);
		}
		
		var bars = sourceGroups.selectAll("rect").data(Object, function(d) {
			return d.x;
		});
		bars.transition().duration(transitionMs)
			.attr("x", valueX)
			.attr("y", valueY)
			.attr("height", heightY)
			.attr("width", xBar.rangeBand());
		
		var entered = bars.enter().append("rect")
			.attr("x", valueX)
			.attr("y", centerYLoc)
			.attr("height", 1e-6)
			.attr("width", xBar.rangeBand());
		
		entered.transition().duration(transitionMs)
			.attr("y", valueY)
			.attr("height", heightY);
		
		bars.exit().transition().duration(transitionMs)
			.style("opacity", 1e-6)
  			.remove();
		
	}

	that.sources = sources;
	
	/**
	 * Get the x-axis domain (minimum and maximum dates).
	 * 
	 * @return {number[]} an array with the minimum and maximum values used in the x-axis of the chart
	 * @memberOf sn.chart.energyIOBarChart
	 */
	that.xDomain = function() { return x.domain(); };

	/**
	 * Get the y-axis domain (minimum and maximum values).
	 * 
	 * @return {number[]} an array with the minimum and maximum values used in the y-axis of the chart
	 * @memberOf sn.chart.energyIOBarChart
	 */
	that.yDomain = function() { return y.domain(); };
	
	/**
	 * Get the scaling factor the y-axis is using. By default this will return {@code 1}.
	 * After calling the {@link #load()} method, however, the chart may decide to scale
	 * the y-axis for clarity. You can call this method to find out the scaling factor the
	 * chart ended up using.
	 *  
	 * @returns the y-axis scale factor
	 * @memberOf sn.chart.energyIOBarChart
	 */
	that.yScale = function() { return displayFactor; };
	
	/**
	 * Get the current {@code aggregate} value in use.
	 * 
	 * @param {number} [value] the number of consumption sources to use
	 * @returns when used as a getter, the count number, otherwise this object
	 * @returns the {@code aggregate} value
	 * @memberOf sn.chart.energyIOBarChart
	 */
	that.aggregate = function(value) { 
		if ( !arguments.length ) return aggregateType;
		aggregateType = (value === 'Month' ? 'Month' : value === 'Day' ? 'Day' : 'Hour');
		return that;
	};
	
	/**
	 * Load data for the chart. The data is expected to be in a form suitable for
	 * passing to {@link sn.energyPerSourceArray}.
	 * 
	 * @param {Array} rawData - the raw chart data to load
	 * @returns this object
	 * @memberOf sn.chart.energyIOBarChart
	 */
	that.load = function(rawData) {
		parseConfiguration();
		setup(rawData);
		adjustAxisX();
		adjustAxisY();
		redraw();
		return that;
	};
	
	/**
	 * Regenerate the chart, using the current data. This can be called after disabling a
	 * source 
	 * 
	 * @returns this object
	 * @memberOf sn.chart.energyIOBarChart
	 */
	that.regenerate = function() {
		if ( layerGenerator === undefined ) {
			// did you call load() first?
			return that;
		}
		parseConfiguration();
		layers = layerGenerator();
		computeDomainY();
		adjustAxisX();
		adjustAxisY();
		redraw();
		return that;
	};
	
	/**
	 * Get or set the consumption source count. Set this to the number of sources that 
	 * are considered "consumption" and should show up <em>under</em> the y-axis origin.
	 * The sources are assumed to already be ordered with consumption before generation.
	 * 
	 * @param {number} [value] the number of consumption sources to use
	 * @returns when used as a getter, the count number, otherwise this object
	 * @memberOf sn.chart.energyIOBarChart
	 */
	that.consumptionSourceCount = function(value) {
		if ( !arguments.length ) return consumptionLayerCount;
		consumptionLayerCount = +value; // the + used to make sure we have a Number
		return that;
	};

	/**
	 * Get or set the animation transition time, in milliseconds.
	 * 
	 * @param {number} [value] the number of milliseconds to use
	 * @return when used as a getter, the millisecond value, otherwise this object
	 * @memberOf sn.chart.energyIOBarChart
	 */
	that.transitionMs = function(value) {
		if ( !arguments.length ) return transitionMs;
		transitionMs = +value; // the + used to make sure we have a Number
		return that;
	};
	
	parseConfiguration();
	return that;
};