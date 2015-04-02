/*global sn,d3 */
(function() {
'use strict';

if ( sn === undefined ) {
	sn = { chart: {} };
} else if ( sn.chart === undefined ) {
	sn.chart = {};
}

/**
 * @typedef sn.chart.energyIOPieChartParameters
 * @type {sn.Configuration}
 * @property {number} [width=812] - desired width, in pixels, of the chart
 * @property {number} [height=300] - desired height, in pixels, of the chart
 * @property {number[]} [padding=[10, 0, 20, 30]] - padding to inset the chart by, in top, right, bottom, left order
 * @property {number} [transitionMs=600] - transition time
 * @property {sn.Configuration} excludeSources - the sources to exclude from the chart
 * @property {boolean} [hidePercentages=false] - if false, show percentages represented by each slice
 * @property {boolean} [hideValues=false] - if false, show the actual values represented by each slice
 * @property {number} [innerRadius=0] - an inner radius for the chart, in pixels
 * @property {number} [percentageLabelMinimumPercent=5] - the minimum percentage necessary for a percentage label to appear
 * @property {number} [valueLabelMinimumPercent=5] - the minimum percentage necessary for a value label to appear
 */

/**
 * An power input and output chart designed to show consumption and generation data as an overall
 * percentage.
 * 
 * You can use the {@code excludeSources} parameter to dynamically alter which sources are visible
 * in the chart. After changing the configuration call {@link sn.chart.energyIOPieChart#regenerate()}
 * to re-draw the chart.
 * 
 * @class
 * @param {string} containerSelector - the selector for the element to insert the chart into
 * @param {sn.chart.energyIOPieChartParameters} [chartConfig] - the chart parameters
 * @returns {sn.chart.energyIOPieChart}
 */
sn.chart.energyIOPieChart = function(containerSelector, chartConfig) {
	var that = {
		version : '1.0.0'
	};
	var sources = [];
	var config = (chartConfig || new sn.Configuration());
	
	// default to container's width, if we can
	var containerWidth = sn.pixelWidth(containerSelector);
	
	var p = (config.padding || [24, 24, 24, 24]),
		w = (config.width || containerWidth || 300) - p[1] - p[3],
		h = (config.height || 300) - p[0] - p[2],
		r = d3.min([w, h]) / 2;

	var transitionMs = undefined;
	
	var svgRoot = undefined,
		chartData = undefined,
		chartLabels = undefined;
	
	var colorCallback = undefined; // function accepts (groupId, sourceId) and returns a color
	var sourceExcludeCallback = undefined; // function accepts (groupId, sourceId) and returns true to exclue group
	var displayFactorCallback = undefined; // function accepts (maxY) and should return the desired displayFactor
	var layerKeyCallback = undefined; // function accepts datum and should return string key
	var layerKeySort = sortSliceKeys;

	var percentFormatter = d3.format('.0%');

	var originalData = {};
	var groupIds = [];
	var pieSlices = undefined;
	var totalValue = 0;
	var innerRadius = 0;
	var arc = d3.svg.arc();
	
	function sortSliceKeys(d1, d2) {
		return d1.key.localeCompare(d2.key);
	}
	
	function parseConfiguration() {
		transitionMs = (config.value('transitionMs') || 600);
		innerRadius = (config.value('innerRadius') || 0);
		arc.innerRadius(innerRadius)
			.outerRadius(r);
	}

	parseConfiguration();

	svgRoot = d3.select(containerSelector).select('svg');
	if ( svgRoot.empty() ) {
		svgRoot = d3.select(containerSelector).append('svg:svg')
			.attr('class', 'chart')
			.attr("width", w + p[1] + p[3])
			.attr("height", h + p[0] + p[2]);
	} else {
		svgRoot.selectAll('*').remove();
	}

	chartData = svgRoot.append("g")
		.attr('class', 'data')
		.attr("transform", "translate(" + ((w + p[1] + p[3]) / 2) + "," + ((h + p[0] + p[2]) / 2) + ")");
	
	chartLabels = svgRoot.append("g")
		.attr('class', 'label')
		.attr("transform", "translate(" + ((w + p[1] + p[3]) / 2) + "," + ((h + p[0] + p[2]) / 2) + ")");

	// setup display units in kW if domain range > 1000
	var displayFactor = 1;
	var displayFormatter = d3.format(',d');
	
	function sliceValue(d) {
		return d.value;
	}
	
	function computeUnits() {
		var fmt;
		var maxValue = d3.max(pieSlices, sliceValue);
		displayFactor = 1;
		
		if ( displayFactorCallback ) {
			displayFactor = displayFactorCallback.call(that, maxValue);
		} else if ( maxValue >= 1000000000 ) {
			displayFactor = 1000000000;
		} else if ( maxValue >= 1000000 ) {
			displayFactor = 1000000;
		} else if ( maxValue >= 1000 ) {
			displayFactor = 1000;
		}

		if ( displayFactor >= 1000000 ) {
			fmt = ',.2f';
		} else if ( displayFactor === 1000 ) {
			fmt = ',.1f';
		} else if ( displayFactor === 1 ) {
			fmt = ',d';
		} else {
			fmt = ',g';
		}

		displayFormatter = d3.format(fmt);
		
		totalValue = d3.sum(pieSlices, sliceValue);
	}
	
	function displayFormat(d) {
		return displayFormatter(d / displayFactor);
	}
	
	function setup() {
		var combinedRollup = [];
		
		groupIds.forEach(function(groupId) {
			var keyFn = function(d, i) {
				return (layerKeyCallback 
					? layerKeyCallback.call(that, groupId, d, i) 
					: (groupId + '-' +d.sourceId).replace(/\W/, '-'));
			};
			var rollup = d3.nest()
				.key(keyFn)
				.rollup(function(group) {
					var result = { sum : 0, groupId : groupId };
					if ( group.length ) {
						result.sourceId = group[0].sourceId;
						result.sum = d3.sum(group, function(d) {
							return (sourceExcludeCallback && sourceExcludeCallback.call(that, groupId, d.sourceId)
								? 0 : d.wattHours); // TODO add plotProperty
						});
					}
					return result;
				})
				.entries(originalData[groupId]);
		
			// remove excluded sources...
			if ( sourceExcludeCallback ) {
				rollup = rollup.filter(function(e) {
					return !sourceExcludeCallback.call(that, groupId, e.key);
				});
			}
			
			combinedRollup = combinedRollup.concat(rollup.map(function(e) {
				e.values.key = e.key; // add key to values, for sorting
				return e.values; 
			}));
		});
				
		
		var pie = d3.layout.pie()
			.sort(layerKeySort)
			.value(function(d) {
				return d.sum;
			});
		
		pieSlices = pie(combinedRollup);
		
		computeUnits();
	}
	
	function pieSliceColorFn(d, i) {
		if ( colorCallback ) {
			return colorCallback.call(that, d.data.groupId, d.data.sourceId, i);
		}
		var colors = d3.scale.category10().range();
		return colors[i % colors.length];
	}
	
	function clearOpacity() {
		d3.select(this).style("opacity", null);
	}
	
	function arcTween(d) {
		var iStart = d3.interpolate(this._data_start.startAngle, d.startAngle);
		var iEnd = d3.interpolate(this._data_start.endAngle, d.endAngle);
		this._data_start = d;
		return function(t) {
			var td = {startAngle:iStart(t), endAngle:iEnd(t)};
			return arc(td);
		};
	}
	
	function pieSliceKey(d) {
		return d.data.key;
	}

	function draw() {	
		// draw data areas
		var pie = chartData.selectAll("path").data(pieSlices, pieSliceKey);
		
		pie.transition().duration(transitionMs)
			.attr("d", arc)
			.style("fill", pieSliceColorFn)
			.attrTween("d", arcTween);

		pie.enter().append("path")
			.attr("class", function(d, i) {
				return 'area ' +d.data.key;
			})
			.style("fill", pieSliceColorFn)
			.style("opacity", 1e-6)
			.attr("d", arc)
			.each(function(d) { this._data_start = d; }) // to support transitions
		.transition().duration(transitionMs)
			.style("opacity", 1)
			.each('end', clearOpacity);

		pie.exit().transition().duration(transitionMs)
			.style("opacity", 1e-6)
			.remove();
		
		redrawLabels();
	}
	
	function halfAngle(d) {
		return (d.startAngle + (d.endAngle - d.startAngle) / 2);
	}
	
	function halfAngleForLabel(d) {
		return halfAngle(d) - Math.PI / 2;
	}
	
	function halfWayRotation(d) {
		var a = halfAngle(d);
		var degrees = sn.rad2deg(a);
		return ('rotate(' +degrees +')');
	}
	
	function halfWayAngleTransformTween(d, r) {
		var i = d3.interpolate(halfAngle(this._data_start), halfAngle(d));
		this._data_start = d;
		return function(t) {
			var a = i(t) - Math.PI / 2;
			return "translate(" + (Math.cos(a) * r) + "," +(Math.sin(a) * r) +")";
		};
	}
	
	function halfWayAngleTransform(d, r) {
		var a = halfAngleForLabel(d);
		return "translate(" + (Math.cos(a) * r) + "," +(Math.sin(a) * r) +")";
	}
	
	// format the data's actual value
	function outerText(d) {
		return displayFormatter(d.value / displayFactor);
	}
	
	// format the data's value as a percentage of the overall pie value
	function innerText(d) {
		return percentFormatter(d.value / totalValue);
	}
	
	function outerTextAnchor(d) {
		var a = halfAngle(d);
		if ( a < Math.PI * 2 * (1/8) || a > Math.PI * 2 * (7/8) ) {
			return 'middle';
		} else if ( a < Math.PI * 2 * (3/8) ) {
			return 'start';
		} else if ( a < Math.PI * 2 * (5/8) ) {
			return 'middle';
		}
		return 'end';
	}
	
	function outerTextDY(d) {
		var a = halfAngle(d);
		if ( a >= Math.PI * 2 * (3/8) && a < Math.PI * 2 * (5/8) ) {
			return '0.5em';
		}
		return 0;
	}
	
	function innerLabelMinValue() {
		var m = Number(config.value('percentageLabelMinimumPercent'));
		return (isNaN(m) ? 5 : m) / 100 * totalValue;
	}
	
	function outerLabelMinValue() {
		var m = Number(config.value('valueLabelMinimumPercent'));
		return (isNaN(m) ? 5 : m) / 100 * totalValue;
	}
	
	function redrawLabels() {
		/* TODO: the idea for drawing lines would be if the pie slice is too small to 
		 * show a value inside. We'd draw a line out from the slice, using the same
		 * color as the slice.

		// draw data labels
		var lines = chartLabels.selectAll("line").data(pieSlices, pieSliceKey);
		
		lines.transition().duration(transitionMs)
			.attr('transform', halfWayRotation);
		
		// we'll draw vertical lines, and then rotate them to match the half way angle
		// between the start/end angles defined on our data elements
		lines.enter().append("line")
			.attr("class", "tick")
			.attr("y1", -Math.floor(r - 10))
			.attr("y2", -Math.floor(r + 10))
			.style("opacity", 1e-6)
			.attr('transform', halfWayRotation)
		.transition().duration(transitionMs)
			.style("opacity", 1)
			.each("end", clearOpacity);
		
		lines.exit().transition().duration(transitionMs)
			.style("opacity", 1e-6)
			.remove();
		*/
		
		// show outer labels of actual values
		var outerMinValue = outerLabelMinValue();
		var outerLabelData = (config.enabled('hideValues') 
			? []
			: pieSlices.filter(function(e) { return e.value > outerMinValue; }));
		
		var outerLabels = chartLabels.selectAll("text.outer").data(outerLabelData, pieSliceKey);
			
		outerLabels.transition().duration(transitionMs)
			.text(outerText)
			.attr("text-anchor", outerTextAnchor)
			.attr("dy", outerTextDY)
			.attr("transform", function(d) { return halfWayAngleTransform(d, r + 15); })
			.attrTween("transform", function(d) { return halfWayAngleTransformTween.call(this, d, r + 15); });
		
		outerLabels.enter().append("text")
			.classed("outer", true)
			.attr("transform", function(d) { return halfWayAngleTransform(d, r + 15); })
			.attr("text-anchor", outerTextAnchor)
			.attr("dy", outerTextDY)
			.style("opacity", 1e-6)
			.text(outerText)
			.each(function(d) { this._data_start = d; }) // to support transitions
		.transition().duration(transitionMs)
			.style("opacity", 1)
			.each("end", clearOpacity);

		outerLabels.exit().transition().duration(transitionMs)
			.style("opacity", 1e-6)
			.remove();
	
		// TODO: remove lables if pie slice too small to hold text for it
		
		// inner labels, showing percentage
		var innerMinValue = innerLabelMinValue();
		var innerLabelData = (config.enabled('hidePercentages') 
			? []
			: pieSlices.filter(function(e) { return e.value > innerMinValue; }));

		var innerLabels = chartLabels.selectAll("text.inner").data(innerLabelData, pieSliceKey);
		
		var labelRadius = (r - innerRadius) / 2 + innerRadius;
			
		innerLabels.transition().duration(transitionMs)
			.text(innerText)
			.attr("transform", function(d) { return halfWayAngleTransform(d, labelRadius); })
			.attrTween("transform", function(d) { return halfWayAngleTransformTween.call(this, d, labelRadius); });
		
		innerLabels.enter().append("text")
			.classed("inner", true)
			.attr("transform", function(d) { return halfWayAngleTransform(d, labelRadius); })
			.attr("text-anchor", "middle")
			.style("opacity", 1e-6)
			.text(innerText)
			.each(function(d) { this._data_start = d; }) // to support transitions
		.transition().duration(transitionMs)
			.style("opacity", 1)
			.each("end", clearOpacity);
	
		innerLabels.exit().transition().duration(transitionMs)
			.style("opacity", 1e-6)
			.remove();
	}

	that.sources = sources;
	
	/**
	 * Get the scaling factor the labels are using. By default this will return {@code 1}.
	 * After calling the {@link #load()} method, however, the chart may decide to scale
	 * the data for clarity. You can call this method to find out the scaling factor the
	 * chart ended up using.
	 *  
	 * @return the y-axis scale factor
	 * @memberOf sn.chart.energyIOPieChart
	 */
	that.scale = function() { return displayFactor; };

	/**
	 * Get the sum total of all slices in the pie chart.
	 *  
	 * @return the sum total energy value, in watt hours
	 * @memberOf sn.chart.energyIOPieChart
	 */
	that.totalValue = function() { return totalValue; };
	
	/**
	 * Clear out all data associated with this chart. Does not redraw.
	 * 
	 * @return this object
	 * @memberOf sn.chart.energyIOPieChart
	 */
	that.reset = function() {
		originalData = {};
		groupIds = [];
		pieSlices = undefined;
		return that;
	};
	
	/**
	 * Add data for a single group in the chart. The data is appended if data has 
	 * already been loaded for the given groupId. This does not redraw the chart. 
	 * Once all groups have been loaded, call {@link #regenerate()} to redraw.
	 * 
	 * @param {Array} rawData - the raw chart data to load
	 * @param {String} groupId - a unique ID to associate with the data
	 * @return this object
	 * @memberOf sn.chart.energyIOPieChart
	 */
	that.load = function(rawData, groupId) {
		if ( originalData[groupId] === undefined ) {
			groupIds.push(groupId);
			originalData[groupId] = rawData;
		} else {
			originalData[groupId].concat(rawData);
		}
		return that;
	};
	
	/**
	 * Regenerate the chart, using the current data. This can be called after disabling a
	 * source, for example.
	 * 
	 * @return this object
	 * @memberOf sn.chart.energyIOPieChart
	 */
	that.regenerate = function() {
		if ( originalData === undefined ) {
			// did you call load() first?
			return that;
		}
		parseConfiguration();
		setup();
		draw();
		return that;
	};
	
	/**
	 * Get or set the animation transition time, in milliseconds.
	 * 
	 * @param {number} [value] the number of milliseconds to use
	 * @return when used as a getter, the millisecond value, otherwise this object
	 * @memberOf sn.chart.energyIOPieChart
	 */
	that.transitionMs = function(value) {
		if ( !arguments.length ) return transitionMs;
		transitionMs = +value; // the + used to make sure we have a Number
		return that;
	};

	/**
	 * Get or set the color callback function. The callback will be passed a datum.
	 * 
	 * @param {function} [value] the color callback
	 * @return when used as a getter, the current color callback function, otherwise this object
	 * @memberOf sn.chart.energyIOPieChart
	 */
	that.colorCallback = function(value) {
		if ( !arguments.length ) return colorCallback;
		if ( typeof value === 'function' ) {
			colorCallback = value;
		}
		return that;
	};
	
	/**
	 * Get or set the display factor callback function. The callback will be passed the maximum 
	 * pie slice value as an argument. It should return a number representing the scale factor to use
	 * in labels.
	 * 
	 * @param {function} [value] the display factor exclude callback
	 * @return when used as a getter, the current display factor callback function, otherwise this object
	 * @memberOf sn.chart.energyIOPieChart
	 */
	that.displayFactorCallback = function(value) {
		if ( !arguments.length ) return displayFactorCallback;
		if ( typeof value === 'function' ) {
			displayFactorCallback = value;
		}
		return that;
	};

	/**
	 * Get or set the source exclude callback function. The callback will be passed the group ID 
	 * and a source ID as arguments. It should true <em>true</em> if the data set for the given
	 * group ID and source ID should be excluded from the chart.
	 * 
	 * @param {function} [value] the source exclude callback
	 * @return when used as a getter, the current source exclude callback function, otherwise this object
	 * @memberOf sn.chart.energyIOPieChart
	 */
	that.sourceExcludeCallback = function(value) {
		if ( !arguments.length ) return sourceExcludeCallback;
		if ( typeof value === 'function' ) {
			sourceExcludeCallback = value;
		}
		return that;
	};

	/**
	 * Get or set the layer key callback function. The callback will be passed a group ID and datum and should
	 * return the rollup key to use.
	 * 
	 * @param {function} [value] the layer key callback
	 * @return when used as a getter, the current layer key callback function, otherwise this object
	 * @memberOf sn.chart.energyIOPieChart
	 */
	that.layerKeyCallback = function(value) {
		if ( !arguments.length ) return layerKeyCallback;
		if ( typeof value === 'function' ) {
			layerKeyCallback = value;
		}
		return that;
	};

	/**
	 * Get or set the layer key sort function. The function will be passed two datum and should
	 * return -1, 0, or 1 if they are in descending, equal, or ascending order.
	 * 
	 * @param {function} [value] the layer sort callback
	 * @return when used as a getter, the current layer key sort function, otherwise this object
	 * @memberOf sn.chart.energyIOPieChart
	 */
	that.layerKeySort = function(value) {
		if ( !arguments.length ) return layerKeySort;
		if ( typeof value === 'function' ) {
			layerKeySort = value;
		}
		return that;
	};

	return that;
};


}());
