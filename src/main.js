import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './global.css';
import noUiSlider from 'nouislider';
import 'nouislider/dist/nouislider.css';

import data from '/static/meteors.json';


const map = L.map('map').setView([59.9, 10.75], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let allMeteorData = [];
let markersAndLines = [];

const defaultStartTime = new Date("2025-01-01T00:00:00Z").valueOf() / 1000;
let startTime = defaultStartTime;
let endTime;
let minStartHeight = 0;
let maxStartHeight = 150;
let minEndHeight = 0;
let maxEndHeight = 150;
let minEccentricity = 0;
let maxEccentricity = Number.MAX_VALUE;

Promise.resolve(data)
    .then(data => {
        allMeteorData = data;

        // Find min/max observation times
        const allTimes = data.flatMap(event =>
            event.observations.map(obs => obs.observationStartTime)
                .filter(time => time > 0)
        );
        const minTime = Math.min(...allTimes);
        const maxTime = Math.max(...allTimes);
        endTime = maxTime;

        const timeSlider = document.getElementById('time-slider');

        // Format Unix timestamp to readable
        function formatTimestamp(ts) {
            if (typeof ts !== 'number' || isNaN(ts)) return '--';
            const date = new Date(ts * 1000);
            if (isNaN(date.getTime())) return '--';
            return date.toISOString().split('T')[0] + ' ' + date.toISOString().split('T')[1].slice(0, 5);
        }

        noUiSlider.create(timeSlider, {
            start: [defaultStartTime, maxTime],
            connect: true,
            step: 7 * 24 * 60 * 60, // step by 1 week
            range: {
                min: minTime,
                max: maxTime
            },
            tooltips: [true, true],
            format: {
                to: ts => formatTimestamp(ts),
                from: val => new Date(Number(val))
            }
        });

        // Listen for slider changes and re-render
        timeSlider.noUiSlider.on('update', function (values, handle, unformatted) {
            const [start, end] = unformatted;
            startTime = start;
            endTime = end;
            filterAndRender();
        });

        const startHeightSlider = document.getElementById('start-height-slider');

        noUiSlider.create(startHeightSlider, {
            start: [0, 150],
            connect: true,
            step: 1,
            range: {
                min: 0,
                max: 150
            },
            tooltips: [true, true],
        });

        startHeightSlider.noUiSlider.on('update', function (values, handle, unformatted) {
            [minStartHeight, maxStartHeight] = values;
            filterAndRender();
        });

        const endHeightSlider = document.getElementById('end-height-slider');
        noUiSlider.create(endHeightSlider, {
            start: [0, 150],
            connect: true,
            step: 1,
            range: {
                min: 0,
                max: 150
            },
            tooltips: [true, true],
        });
        endHeightSlider.noUiSlider.on('update', function (values, handle, unformatted) {
            [minEndHeight, maxEndHeight] = values;
            filterAndRender();
        });

        const eccentricitySlider = document.getElementById('eccentricity-slider');
        noUiSlider.create(eccentricitySlider, {
            start: [0, 1],
            snap: true,
            connect: true,
            range: {
                'min': 0,
                '16%': 0.25,
                '33%': 0.5,
                '50%': 0.75,
                '67%': 1.0,
                '83%': 2.0,
                'max': Number.MAX_VALUE
            },
            tooltips: [{
                to: ts => ts === Number.MAX_VALUE ? "∞" : ts,
                from: val => val === "∞" ? Number.MAX_VALUE : Number(val)
            }, {
                to: ts => ts === Number.MAX_VALUE ? "∞" : ts,
                from: val => val === "∞" ? Number.MAX_VALUE : Number(val)
            }],
            format: {
                to: ts => ts === Number.MAX_VALUE ? "∞" : ts,
                from: val => val === "∞" ? Number.MAX_VALUE : Number(val)
            }
        });
        eccentricitySlider.noUiSlider.on('update', function (values, handle, unformatted) {
            [minEccentricity, maxEccentricity] = values;
            filterAndRender();
        });

        function filterAndRender() {
            markersAndLines.forEach(layer => map.removeLayer(layer));
            markersAndLines = [];

            // Set to keep track of already added stations
            const addedStations = new Set();

            allMeteorData.forEach(event => {
                const observedInRange = event.observations.some(obs =>
                    obs.observationStartTime >= startTime && obs.observationStartTime <= endTime
                );

                if (!observedInRange) return;

                const atm = event.atmosphericData;
                if (atm && atm.startPositionNorth && atm.startPositionEast &&
                    atm.endPositionNorth && atm.endPositionEast) {

                    if (atm.startHeight < minStartHeight || atm.startHeight > maxStartHeight) {
                        return
                    }

                    if (atm.endHeight < minEndHeight || atm.endHeight > maxEndHeight) {
                        return
                    }
                    const eccentricity = event.orbitalData?.eccentricity;
                    if (eccentricity) {
                        if (eccentricity < minEccentricity || eccentricity > maxEccentricity) {
                            return;
                        }
                    } else if (minEccentricity !== 0 || maxEccentricity != "∞") {
                        // It the observation is missing eccentricity data, only show if the slider is set to 0 and ∞
                        return;
                    }

                    const startLatLng = [atm.startPositionNorth, atm.startPositionEast];
                    const endLatLng = [atm.endPositionNorth, atm.endPositionEast];

                    // Meteor marker
                    const marker = L.circleMarker(startLatLng, {
                        radius: 6,
                        color: 'darkblue',
                        fillColor: 'blue',
                        fillOpacity: 0.8
                    }).addTo(map)
                        .bindPopup(`<a href="http://norskmeteornettverk.no/meteor/${event.id.replace("_", "/")}" target="_blank">ID: ${event.id}</a><br>Observert av: ${event.observations.map(obs => obs.stationCode)}<br>Slutthøyde: ${atm.endHeight} km<br>Starthøyde: ${atm.startHeight} km`);
                    markersAndLines.push(marker);

                    // Trajectory
                    const line = L.polyline([startLatLng, endLatLng], {
                        color: 'blue',
                        weight: 2,
                        opacity: 0.8
                    }).addTo(map);
                    markersAndLines.push(line);
                }

                event.observations.forEach(obs => {
                    const key = `${obs.stationCode}_${obs.stationLatitude}_${obs.stationLongitude}`;
                    if (!addedStations.has(key)) {
                        addedStations.add(key);

                        const stationLatLng = [obs.stationLatitude, obs.stationLongitude];

                        // Circle marker with label
                        const stationMarker = L.circleMarker(stationLatLng, {
                            radius: 8,
                            color: 'red',
                            fillColor: '#a00',
                            fillOpacity: 0.7
                        }).addTo(map)
                            .bindPopup(`Stasjon: ${obs.stationCode}`);
                        markersAndLines.push(stationMarker);

                        // Optional: add a small label next to each station
                        const stationLabel = L.marker(stationLatLng, {
                            icon: L.divIcon({
                                className: 'station-label',
                                html: obs.stationCode,
                                iconSize: [30, 12],
                                iconAnchor: [15, -5]
                            })
                        }).addTo(map);
                        markersAndLines.push(stationLabel);
                    }
                });
            });

        }

        // Initial render
        filterAndRender();
    });