import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./global.css";
import noUiSlider from "nouislider";
import "nouislider/dist/nouislider.css";

import data from "/static/meteors.json";

function formatTimestamp(ts) {
  if (typeof ts !== "number" || isNaN(ts)) return "--";
  const date = new Date(ts * 1000);
  if (isNaN(date.getTime())) return "--";
  return (
    date.toISOString().split("T")[0] +
    " " +
    date.toISOString().split("T")[1].slice(0, 5)
  );
}

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
  },
});

let allMeteorData = [];
let markersAndLines = [];

const defaultStartTime = new Date("2025-01-01T00:00:00Z").valueOf() / 1000;
let startTime = defaultStartTime;
let endTime = defaultStartTime + 1000 * 60 * 60 * 24 * 30;
let minStartHeight = 0;
let maxStartHeight = 150;
let minEndHeight = 0;
let maxEndHeight = 150;
let minEccentricity = 0;
let maxEccentricity = Number.MAX_VALUE;

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
        observationPointsFeatures.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [atm.startPositionEast, atm.startPositionNorth], // lng, lat
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
  startTime = minTime;
  endTime = maxTime;

  function filterAndRender() {
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
  }

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
    id: "stations-layer",
    type: "circle",
    source: "stations",
    paint: {
      "circle-radius": 8,
      "circle-color": "#a00",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#fff",
      "circle-opacity": 0.7,
    },
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
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.33, 9, 0],
    },
  });

  map.addLayer({
    id: "observation-points-layer",
    type: "circle",
    source: "observation_points",
    paint: {
      "circle-radius": [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        0,
        2,
        12,
        14,
        20,
        1000,
      ],
      "circle-color": "blue",
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
      "line-opacity": 0.8,
    },
  });

  const timeSlider = document.getElementById("time-slider");
  noUiSlider.create(timeSlider, {
    start: [minTime, maxTime],
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
    ).textContent = `${minStartHeight}–${maxStartHeight} m`;
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
    ).textContent = `${minEndHeight}–${maxEndHeight} m`;
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
});
