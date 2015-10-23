

// ~~~~~~~~~~~~~~~~~~~~~~~~ //
// Map Factory             //
// ~~~~~~~~~~~~~~~~~~~~~~~~ //

// Functions for rendering the map components

(function() {

	angular.module("App")
		.factory("MapFactory", MapFactory);

	MapFactory.$inject = [];

	function MapFactory() {

		var Factory = {};

		var _currentTime;

		Factory.setTime = function(time) { _currentTime = time; }

		Factory.seattle = d3.select("#mapCanvas");
		Factory.stations = d3.select("#stationCanvas");
		Factory.bikes = d3.select("#bikeCanvas");

		Factory.resize = resize;
		Factory.drawMap = drawMap;

		Factory.drawBikes = drawBikes;
		Factory.drawStations = drawStations;

		Factory.setSunScales = setSunScales;
		Factory.waterScale = d3.scale.linear();

		// Minutes it takes a path to fade
		var pathFadeTime = 180;
		
		// The Queue of bike positions to draw
		Factory.bikeQueue = {
			data: [],
			posData: [],
			addData: function(data) {
				data.forEach(function(d) {
					Factory.stations.datum().removeBike(d.from_station_id)
				});
				this.data = this.data.concat(data);
				
			},
			getPositions: function(getCurrentLocation, time) {
				this.data.forEach(function(d) {
					if ((time - d.stoptime_min) >= pathFadeTime) {
						Factory.stations.datum().addBike(d.to_station_id)
					}
				});
				// Filter out data that is too old
				this.data = this.data.filter(function(d) {
					return (time - d.stoptime_min) < pathFadeTime;
				});
				this.posData = this.data.map(function(d) {
					var current = getCurrentLocation(d, time);
					var sameStation = d.from_station_id === d.to_station_id;
					return {
						current: [xScale(current[0]), yScale(current[1]), current[2]],
						start: [xScale(d.startCoords[1]), yScale(d.startCoords[0])],
						sameStation: sameStation,
						opacity: time > d.stoptime_min ? (pathFadeTime + d.stoptime_min - time) / pathFadeTime : 1
					}
				});
			},
			clear: function() {
				this.data = [];
				this.postData = [];
				this.render();
			},
			render: drawBikes
		}

		// Initialize scales
		var xScale = d3.scale.linear();
		var yScale = d3.scale.linear();
		var waterScale = d3.scale.linear();
		var landScale = d3.scale.linear();
		var borderScale = d3.scale.linear();
		var pathScale = d3.scale.linear();

		// d3 zoom behavior
		Factory.stations.call(d3.behavior.zoom()
			.scaleExtent([0.5, 2])
			.on("zoom", zoom))

		// Keep track of translations and zooms
		var translation = [0,0];
		var zoomLevel = 1;
		var retinaZoom = 1;

		// Keep track of width and height
		var width;
		var height;

		return Factory;

		// Set color scales to indicate time of day
		function setSunScales(sunriset) {

			var sunrise = sunriset[1];
			var sunset = sunriset[0];
			sunrise = sunrise[0] * 60 + sunrise[1]; // which minute of day is it
			sunset = sunset[0] * 60 + sunset[1]; // which minute of day is it

			var sunDomainLong = [0, sunrise - 60, sunrise+60, sunset-60, sunset+60, (24*60)];
			var sunDomainShort = [0, sunrise - 10, sunrise+10, sunset-10, sunset+10, (24*60)];

			Factory.waterScale.domain(sunDomainLong);
			landScale.domain(sunDomainLong);
			borderScale.domain(sunDomainLong);
			pathScale.domain(sunDomainShort);

			var waterNight = "#3A4851";
			var waterDay = "#BAD3D0";

			var landNight = "#3F3C3A";
			var landDay = "#E2DCD5";

			var borderNight = "#595959";
			var borderDay = "#F7F7F7";

			var pathNight = "#F2EABD";
			var pathDay = "#4B756D";

			Factory.waterScale.range([waterNight, waterNight, waterDay, waterDay, waterDay, waterNight]);

			landScale.range([landNight, landNight, landDay, landDay, landDay, landNight]);

			borderScale.range([borderNight, borderNight, borderDay, borderDay, borderDay, borderNight]);

			pathScale.range([pathNight, pathNight, pathDay, pathDay, pathDay, pathNight]);

		}

		// Resize behavior called when window size changes.
		function resize() {

			// Find retina zoom level
			var devicePixelRatio = window.devicePixelRatio || 1
			var ctx = Factory.bikes.node().getContext('2d');
	    var backingStoreRatio = ctx.webkitBackingStorePixelRatio ||
        ctx.mozBackingStorePixelRatio ||
        ctx.msBackingStorePixelRatio ||
        ctx.oBackingStorePixelRatio ||
        ctx.backingStorePixelRatio || 1

      // retinaZoom = 1;
      retinaZoom = devicePixelRatio / backingStoreRatio;

      // zoomLevel = zoomLevel * retinaZoom;

			// find new bounding box
			var bbox = Factory.seattle.node().parentNode.getBoundingClientRect();

			width = bbox.width * retinaZoom;
			height = bbox.height * retinaZoom;

			// Resize canvases
			Factory.bikes.attr("width", width);
			Factory.bikes.attr("height", height);
			Factory.stations.attr("width", width);
			Factory.stations.attr("height", height);
			Factory.seattle.attr("width", width);
			Factory.seattle.attr("height",height);

			Factory.bikes.style("width", width/retinaZoom + "px");
			Factory.bikes.style("height", height/retinaZoom + "px");
			Factory.stations.style("width", width/retinaZoom + "px");
			Factory.stations.style("height", height/retinaZoom + "px");
			Factory.seattle.style("width", width/retinaZoom + "px");
			Factory.seattle.style("height", height/retinaZoom + "px");

			// Update x and y scales with new domain and range.
			// The domain has to change because we don't want it to scale down
			// at small sizes
			var screenScale = Math.min(250, width, height);

			// Always focus the map on this point when zoomed out?
			var mapCenterX = -122.3215;
			var mapCenterY = 47.63;

			xScale
				.domain([
					mapCenterX - 0.016 * (width/screenScale) / retinaZoom,
					mapCenterX + 0.016 * (width/screenScale) / retinaZoom
					])
				.range([0,width/retinaZoom]);

			yScale
				.domain([
					mapCenterY - 0.011 * (height/screenScale) / retinaZoom,
					mapCenterY + 0.011 * (height/screenScale) / retinaZoom
					])
				.range([height/retinaZoom,0]);

		}

		function drawBikes() {

			var bikes = Factory.bikeQueue.posData;

			// Get context, clear it, save it's state, then apply current
			// translation and zoom
			var ctx = Factory.bikes.node().getContext("2d");
			ctx.clearRect(0, 0, width, height);
			ctx.save()
			ctx.translate(translation[0], translation[1]);
			ctx.scale(zoomLevel * retinaZoom, zoomLevel * retinaZoom);

			ctx.strokeStyle = _currentTime ? pathScale(_currentTime) : "white";
			ctx.lineWidth=2;

			// Draw the fading lines
			angular.forEach(bikes.filter(function(bike) {
				return bike.opacity < 1;
			}), function (bike) {

				ctx.save();
				ctx.globalAlpha = Math.round(100 * bike.opacity * 0.15) / 100;
				ctx.beginPath();

				if (bike.sameStation) {

					ctx.arc(bike.start[0],bike.start[1],14,-bike.current[2],0)

				} else {

					ctx.moveTo(bike.start[0], bike.start[1]);
					ctx.lineTo(bike.current[0],bike.current[1]);

				}

				ctx.stroke();
				ctx.restore();

			});

			ctx.strokeStyle = _currentTime ? pathScale(_currentTime) : "rgba(255,255,255,0.15)";

			// Active bike lines
			angular.forEach(bikes.filter(function(bike) {
				return bike.opacity === 1 && bike.sameStation;
			}), function (bike) {

				ctx.beginPath();
				ctx.arc(bike.start[0],bike.start[1],14,-bike.current[2],0)

			});

			ctx.stroke();

			// Active bike lines
			angular.forEach(bikes.filter(function(bike) {
				return bike.opacity === 1 && !bike.sameStation;
			}), function (bike) {

				ctx.moveTo(bike.start[0], bike.start[1]);
				ctx.lineTo(bike.current[0],bike.current[1]);

			});

			// Draw all active lines
			ctx.stroke();

			// ctx.fillStyle = "#FEDE94";
			// ctx.strokeStyle = "#333";

			// angular.forEach(bikes.filter(function(bike) {
			// 	return bike.opacity === 1;
			// }), function(bike) {
			// 	// Draw bike
			// 	ctx.beginPath();
			// 	ctx.arc(bike.current[0],bike.current[1],3,0,2*Math.PI);
			// });

			// ctx.stroke();
			// ctx.fill();

			
			// // Draw each bike
			// angular.forEach(bikes, function(bike) {

			// 	// ctx.save()
			// 	ctx.globalAlpha = Math.round(100 * bike.opacity * 0.15) / 100;

			// 	if (!bike.sameStation) {

			// 		// Draw bike paths
			// 		ctx.beginPath();
			// 		ctx.moveTo(bike.start[0], bike.start[1]);
			// 		ctx.lineTo(bike.current[0],bike.current[1]);
			// 		// ctx.lineWidth=2;
			// 		// ctx.strokeStyle = _currentTime ? pathScale(_currentTime) : "#FDFBE8"
			// 		// ctx.stroke();

			// 	} else {

			// 		// Draw "joy ride" circles around stations
			// 		ctx.beginPath();
			// 		ctx.arc(bike.start[0],bike.start[1],14,-bike.current[2],0)
			// 		// ctx.lineWidth=2;
			// 		// ctx.strokeStyle = _currentTime ? pathScale(_currentTime) : "#FDFBE8";
			// 		// ctx.stroke();

			// 	}

			// 	ctx.stroke();
			// 	ctx.restore()

			// });

			

				// // Draw bike
				// ctx.beginPath();
				// ctx.arc(bike.current[0],bike.current[1],3,0,2*Math.PI);
				// ctx.fillStyle = "#FEDE94";
				// ctx.lineWidth=2;
				// ctx.strokeStyle = "#333";
				// ctx.stroke();
				// ctx.fill();

			// });

			ctx.restore();

		}


		function drawStations(stations) {

			// Either store the new data
			// OR pull it from memory
			if (stations) {
				Factory.stations.datum(stations)
			} else {
				stations = Factory.stations.datum();
			}

			console.log(stations[1].count)

			// Get context, clear it, save it's state, then apply current
			// translation and zoom
			var ctx = Factory.stations.node().getContext("2d");
			ctx.clearRect(0, 0, width, height);
			ctx.save()
			ctx.translate(translation[0], translation[1]);
			ctx.scale(zoomLevel * retinaZoom, zoomLevel * retinaZoom);

			angular.forEach(stations, function(station) {

				var r = Math.max(3, (station.count/3) + 6);
				
				// Station x and y in pixel coords
				var x = xScale(+station.long);
				var y = yScale(+station.lat);

				// Draw circles
				ctx.beginPath();
				ctx.arc(x,y,r,0,2*Math.PI);
				ctx.fillStyle = "#D68950";
				ctx.lineWidth=2;
				ctx.strokeStyle = _currentTime ? landScale(_currentTime) : "#333";
				ctx.fill();
				ctx.stroke();

			});

			// Restore previous state
			ctx.restore();

		}

		function drawMap(polygons) {

			// Either store the new data
			// OR pull it from memory
			if (polygons) {
				Factory.seattle.datum(polygons)
			} else {
				polygons = Factory.seattle.datum();
			}

			// Get context, clear it, save it's state, then apply current
			// translation and zoom
			var ctx = Factory.seattle.node().getContext('2d');
			ctx.clearRect(0, 0, width, height);
			ctx.save()
			ctx.translate(translation[0], translation[1]);
			ctx.scale(zoomLevel * retinaZoom, zoomLevel * retinaZoom);

			// Apply style attributes and draw polygons
			ctx.fillStyle = _currentTime ? landScale(_currentTime) : "#333";
			ctx.strokeStyle = _currentTime ? borderScale(_currentTime) : "#444";
			ctx.lineWidth = 1;
			
			// ctx.beginPath();
			// For each polygon, move the line path and continue drawing until
			// that poylgon is finished
			for (var i=0; i<polygons.length; i++) {
				var polygon = polygons[i];
				ctx.beginPath();
				ctx.moveTo(xScale(polygon[0].x), yScale(polygon[0].y));
				for (var k=1; k<polygon.length; k++) {
					ctx.lineTo(xScale(polygon[k].x), yScale(polygon[k].y));
				}
				ctx.fill();
				ctx.stroke();
			}

			// Restore previous state
			ctx.restore();

		}

		// When zoomed everything has to be redrawn
		function zoom() {

			// Update translation and zoom
			translation = d3.event.translate;
			zoomLevel = d3.event.scale;

			// var canvas = Factory.seattle.node().getContext("2d");
			// canvas.save();
			drawMap();
			// canvas.restore();

			// canvas = Factory.stations.node().getContext("2d");
			// canvas.save();
			drawStations();
			// canvas.restore();

			// canvas = Factory.bikes.node().getContext("2d");
			// canvas.save();
			drawBikes();
			// canvas.restore();

		}




	}

})();

