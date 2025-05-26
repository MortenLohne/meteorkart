import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./global.css";
import { calculateBearing, formatTimestamp, wgs84ToWebMercator } from "./utils";
import noUiSlider from "nouislider";
import "nouislider/dist/nouislider.css";
import { quadtree } from "d3-quadtree";

import data from "/static/meteors.json";
import { throttle } from "lodash-es";

const map = new maplibregl.Map({
  container: "map",
  center: [10.75, 59.9],
  attributionControl: {
    customAttribution:
      'Data: <a href="https://norskmeteornettverk.no/">Norsk meteornettverk</a>',
  },
  zoom: 6,
  style: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: [
          "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution:
          '<a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap</a>',
      },
    },
    layers: [
      {
        id: "osm",
        type: "raster",
        source: "osm",
      },
    ],
    glyphs: "/static/{fontstack}/{range}.pbf",
  },
});

map.loadImage("/static/icons/triangle.png").then((image) => {
  map.addImage("triangle", image.data, { sdf: true });
});

map.loadImage("/static/icons/square.png").then((image) => {
  map.addImage("square", image.data, { sdf: true });
});

let allMeteorData = [];

const defaultStartTime = new Date("2025-01-01T00:00:00Z").valueOf() / 1000;
let startTime = defaultStartTime;
let endTime = defaultStartTime + 1000 * 60 * 60 * 24 * 30;
let minStartHeight = 0;
let maxStartHeight = 150;
let minEndHeight = 0;
let maxEndHeight = 150;
let minEccentricity = 0;
let maxEccentricity = Number.MAX_VALUE;

let observationPointsQuadtree = quadtree()
  .x((d) => d.properties.x)
  .y((d) => d.properties.y)
  .addAll([]);

Promise.resolve(data).then(async (data) => {
  allMeteorData = data;

  function buildSources(data) {
    const observationPointsFeatures = [];
    const observationTracksFeatures = [];
    const stationSet = new Set();
    const stationFeatures = [];

    data.forEach((event) => {
      const atm = event.atmosphericData;

      if (
        atm &&
        atm.startPositionNorth &&
        atm.startPositionEast &&
        atm.endPositionNorth &&
        atm.endPositionEast
      ) {
        const bearing = calculateBearing(
          atm.startPositionNorth,
          atm.startPositionEast,
          atm.endPositionNorth,
          atm.endPositionEast
        );

        const xyCoordinates = wgs84ToWebMercator(
          atm.endPositionEast,
          atm.endPositionNorth
        );

        observationPointsFeatures.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [atm.endPositionEast, atm.endPositionNorth], // lng, lat
          },
          properties: {
            eventId: event.id,
            observationStartTime: Math.min(
              ...event.observations.map((d) => d.observationStartTime)
            ),
            bearing,
            x: xyCoordinates.x,
            y: xyCoordinates.y,
            ...atm,
            ...event.orbitalData,
          },
        });
        observationTracksFeatures.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [atm.startPositionEast, atm.startPositionNorth],
              [atm.endPositionEast, atm.endPositionNorth],
            ],
          },
          properties: {
            eventId: event.id,
            observationStartTime: Math.min(
              ...event.observations.map((d) => d.observationStartTime)
            ),
            ...atm,
            ...event.orbitalData,
          },
        });
      }

      event.observations.forEach((obs) => {
        const key = `${obs.stationCode}_${obs.stationLatitude}_${obs.stationLongitude}`;
        if (!stationSet.has(key)) {
          stationSet.add(key);
          stationFeatures.push({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [obs.stationLongitude, obs.stationLatitude], // lng, lat
            },
            properties: {
              stationCode: obs.stationCode,
            },
          });
        }
      });
    });

    return {
      stations: {
        type: "FeatureCollection",
        features: stationFeatures,
      },
      observation_points: {
        type: "FeatureCollection",
        features: observationPointsFeatures,
      },
      observation_tracks: {
        type: "FeatureCollection",
        features: observationTracksFeatures,
      },
    };
  }

  let sources = buildSources(allMeteorData);

  const allTimes = data.flatMap((event) =>
    event.observations
      .map((obs) => obs.observationStartTime)
      .filter((time) => time > 0)
  );

  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);
  endTime = maxTime;

  function rawFilterAndRender() {
    const observationFilter = [
      "all",
      [">=", ["get", "observationStartTime"], startTime],
      ["<=", ["get", "observationStartTime"], endTime],
      [">=", ["get", "startHeight"], minStartHeight],
      ["<=", ["get", "startHeight"], maxStartHeight],
      [">=", ["get", "endHeight"], minEndHeight],
      ["<=", ["get", "endHeight"], maxEndHeight],
    ];

    if (!(minEccentricity === 0 && maxEccentricity === Number.MAX_VALUE)) {
      observationFilter.push([
        "all",
        ["has", "eccentricity"],
        [">=", ["get", "eccentricity"], minEccentricity],
        ["<=", ["get", "eccentricity"], maxEccentricity],
      ]);
    }

    map.setFilter("observation-points-layer", observationFilter);
    map.setFilter("observation-heatmap-layer", observationFilter);
    map.setFilter("observation-tracks-layer", observationFilter);

    const visibleStationKeys = new Set();
    allMeteorData.forEach((event) => {
      const atm = event.atmosphericData;
      const eccentricity = event.orbitalData?.eccentricity;

      if (
        atm &&
        atm.startPositionNorth &&
        atm.startPositionEast &&
        atm.endPositionNorth &&
        atm.endPositionEast &&
        atm.startHeight >= minStartHeight &&
        atm.startHeight <= maxStartHeight &&
        atm.endHeight >= minEndHeight &&
        atm.endHeight <= maxEndHeight
      ) {
        const obsTimeInRange = event.observations.some(
          (obs) =>
            obs.observationStartTime >= startTime &&
            obs.observationStartTime <= endTime
        );
        if (!obsTimeInRange) return;
        const eccentricityOk =
          typeof eccentricity === "number"
            ? eccentricity >= minEccentricity && eccentricity <= maxEccentricity
            : minEccentricity === 0 && maxEccentricity === Number.MAX_VALUE;
        if (!eccentricityOk) return;

        event.observations.forEach((obs) => {
          const key = `${obs.stationCode}_${obs.stationLatitude}_${obs.stationLongitude}`;
          visibleStationKeys.add(key);
        });
      }
    });
    // Filter original station features
    const newStationsGeoJSON = {
      type: "FeatureCollection",
      features: sources.stations.features.filter((feature) => {
        const key = `${feature.properties.stationCode}_${feature.geometry.coordinates[1]}_${feature.geometry.coordinates[0]}`;
        return visibleStationKeys.has(key);
      }),
    };
    map.getSource("stations").setData(newStationsGeoJSON);

    // Update quadtree with filtered observation points
    const filteredObservationPoints =
      sources.observation_points.features.filter((feature) => {
        const props = feature.properties;
        return (
          props.observationStartTime >= startTime &&
          props.observationStartTime <= endTime &&
          props.startHeight >= minStartHeight &&
          props.startHeight <= maxStartHeight &&
          props.endHeight >= minEndHeight &&
          props.endHeight <= maxEndHeight &&
          (props.eccentricity === undefined ||
            (props.eccentricity >= minEccentricity &&
              props.eccentricity <= maxEccentricity))
        );
      });

    observationPointsQuadtree = quadtree()
      .x((d) => d.properties.x)
      .y((d) => d.properties.y)
      .addAll(filteredObservationPoints);
  }

  let filterAndRender = throttle(rawFilterAndRender, 70);

  await new Promise((resolve) => map.once("load", resolve));

  map.addSource("stations", {
    type: "geojson",
    data: sources.stations,
  });
  map.addSource("observation_points", {
    type: "geojson",
    data: sources.observation_points,
  });

  map.addSource("observation_tracks", {
    type: "geojson",
    data: sources.observation_tracks,
  });

  map.addLayer({
    id: "observation-heatmap-layer",
    type: "heatmap",
    source: "observation_points",
    maxzoom: 9,
    paint: {
      "heatmap-weight": 0.1,
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 3, 9, 6],
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0,
        "rgba(0,0,255,0)",
        1,
        "rgb(0,0,255)",
      ],
      // Adjust the heatmap radius by zoom level
      "heatmap-radius": [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        0,
        9,
        9,
        200,
      ],
      // Transition from heatmap to circle layer by zoom level
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.33, 6, 0],
    },
  });

  map.addLayer({
    id: "observation-points-layer",
    type: "symbol",
    source: "observation_points",
    layout: {
      "icon-image": "triangle",
      "icon-size": [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        0,
        0.08,
        8,
        0.4,
        20,
        10,
      ],
      "icon-allow-overlap": true,
      "icon-rotate": ["get", "bearing"],
    },
    paint: {
      "icon-color": "blue",
      "icon-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 6, 1],
    },
  });

  map.addLayer({
    id: "observation-tracks-layer",
    type: "line",
    source: "observation_tracks",
    paint: {
      "line-color": "blue",
      "line-width": [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        4,
        0.25,
        9,
        2,
      ],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0, 6, 1],
    },
  });

  map.addLayer({
    id: "stations-labels",
    type: "symbol",
    source: "stations",
    layout: {
      "text-field": "{stationCode}",
      "text-font": ["lato"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 0, 10, 15, 20],

      "text-offset": [0.5, 0],
      "text-anchor": "left",
      "icon-image": "square",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 0, 0.15, 15, 0.3],

      "icon-allow-overlap": true,
    },
    paint: {
      "text-color": "#000",
      "icon-halo-width": 0.8,
      "icon-halo-color": "#fff",
      "text-halo-color": "#fff",
      "text-halo-width": 1.3,
    },
  });

  const timeSlider = document.getElementById("time-slider");
  noUiSlider.create(timeSlider, {
    start: [startTime, endTime],
    connect: true,
    step: 7 * 24 * 60 * 60, // 1 week
    range: { min: minTime, max: maxTime },
    tooltips: [true, true],
    format: {
      to: (ts) => formatTimestamp(ts),
      from: (val) => new Date(Number(val)),
    },
  });
  timeSlider.noUiSlider.on("update", function (values, handle, unformatted) {
    [startTime, endTime] = unformatted;

    const fmt = Intl.DateTimeFormat("nb-NO", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format;
    let formattedStartDate = fmt(new Date(startTime * 1000));
    let formattedEndDate = fmt(new Date(endTime * 1000));

    document.getElementById(
      "time-value"
    ).textContent = `${formattedStartDate}–${formattedEndDate}`;
    filterAndRender();
  });

  const startHeightSlider = document.getElementById("start-height-slider");
  noUiSlider.create(startHeightSlider, {
    start: [0, 150],
    connect: true,
    step: 1,
    range: { min: 0, max: 150 },
    tooltips: [true, true],
  });
  startHeightSlider.noUiSlider.on("update", function (values) {
    [minStartHeight, maxStartHeight] = values.map(Number);

    document.getElementById(
      "start-height-value"
    ).textContent = `${minStartHeight}–${maxStartHeight} km`;
    filterAndRender();
  });

  const endHeightSlider = document.getElementById("end-height-slider");
  noUiSlider.create(endHeightSlider, {
    start: [0, 150],
    connect: true,
    step: 1,
    range: { min: 0, max: 150 },
    tooltips: [true, true],
  });
  endHeightSlider.noUiSlider.on("update", function (values) {
    [minEndHeight, maxEndHeight] = values.map(Number);
    document.getElementById(
      "end-height-value"
    ).textContent = `${minEndHeight}–${maxEndHeight} km`;
    filterAndRender();
  });

  const eccentricitySlider = document.getElementById("eccentricity-slider");
  const fmtInf = (ts) => (ts === Number.MAX_VALUE ? "∞" : ts);
  noUiSlider.create(eccentricitySlider, {
    start: [0, 1],
    snap: true,
    connect: true,
    range: {
      min: 0,
      "16%": 0.25,
      "33%": 0.5,
      "50%": 0.75,
      "67%": 1.0,
      "83%": 2.0,
      max: Number.MAX_VALUE,
    },
    tooltips: [
      {
        to: fmtInf,
        from: (val) => (val === "∞" ? Number.MAX_VALUE : Number(val)),
      },
      {
        to: fmtInf,
        from: (val) => (val === "∞" ? Number.MAX_VALUE : Number(val)),
      },
    ],
    format: {
      to: fmtInf,
      from: (val) => (val === "∞" ? Number.MAX_VALUE : Number(val)),
    },
  });
  eccentricitySlider.noUiSlider.on("update", function (values) {
    [minEccentricity, maxEccentricity] = values.map((val) =>
      val === "∞" ? Number.MAX_VALUE : Number(val)
    );

    document.getElementById("eccentricity-value").textContent = `${fmtInf(
      minEccentricity
    )}–${fmtInf(maxEccentricity)}`;
    filterAndRender();
  });

  // map.on("mousemove", (e) => {
  //   const point = wgs84ToWebMercator(e.lngLat.lng, e.lngLat.lat);
  //   const nearest = observationPointsQuadtree.find(point.x, point.y);
  //   console.log(nearest);
  // });

  map.on("click", (e) => {
    const point = wgs84ToWebMercator(e.lngLat.lng, e.lngLat.lat);

    const nearest = observationPointsQuadtree.find(point.x, point.y);

    if (nearest) {
      const properties = nearest.properties;
      const eventId = properties.eventId;
      const event = allMeteorData.find((e) => e.id === eventId);
      if (event) {
        const atm = event.atmosphericData;
        const obsTime = properties.observationStartTime;
        const obsTimeFormatted = formatTimestamp(obsTime);
        const format = Intl.NumberFormat("nb-NO", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format;

        const observedBy = Array.from(
          new Set(event.observations.map((obs) => obs.stationCode))
        )
          .map((obs) => `<code>${obs}</code>`)
          .join(", ");

        const url = `https://norskmeteornettverk.no/meteor/${eventId.replace(
          "_",
          "/"
        )}/`;
        let eccentricity = format(event.orbitalData?.eccentricity) ?? "N/A";

        new maplibregl.Popup()
          .setLngLat(nearest.geometry.coordinates)
          .setHTML(
            `
            <h3>${obsTimeFormatted}</h3>
            <strong>Starthøgde:</strong> ${format(atm.startHeight)} km<br>
            <strong>Slutthøgde:</strong> ${format(atm.endHeight)} km<br>
            <strong>Eksentrisitet:</strong> ${eccentricity}<br/>
            <strong>Observert av:</strong> ${observedBy}<br>
            <a href="${url}/" target="_blank">Se mer</a>`
          )
          .addTo(map);
      }
    }
  });
});
