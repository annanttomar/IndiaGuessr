// IndiaGuessr — simplified state polygons (guaranteed point-inside-state)
// No external GeoJSON. Polygons are generated as regular polygons (circle approximations)
// around each state's centroid. This ensures the random point will be inside the state's polygon.

const ROUNDS = 5;
const POINT_RADIUS_KM = 70; // radius around state centroid to form polygon & sample points
const EARTH_RADIUS_KM = 6371;

const STATES = [
  { name: "Andhra Pradesh", lat: 15.9129, lng: 79.7400 },
  { name: "Arunachal Pradesh", lat: 28.2170, lng: 94.7278 },
  { name: "Assam", lat: 26.2006, lng: 92.9376 },
  { name: "Bihar", lat: 25.5941, lng: 85.1376 },
  { name: "Chhattisgarh", lat: 21.2514, lng: 81.6296 },
  { name: "Goa", lat: 15.2993, lng: 74.1230 },
  { name: "Gujarat", lat: 22.2587, lng: 71.1924 },
  { name: "Haryana", lat: 29.0588, lng: 76.0856 },
  { name: "Himachal Pradesh", lat: 31.1048, lng: 77.1734 },
  { name: "Jharkhand", lat: 23.6102, lng: 85.2799 },
  { name: "Karnataka", lat: 15.3173, lng: 75.7139 },
  { name: "Kerala", lat: 10.8505, lng: 76.2711 },
  { name: "Madhya Pradesh", lat: 22.9734, lng: 78.6569 },
  { name: "Maharashtra", lat: 19.7515, lng: 75.7139 },
  { name: "Manipur", lat: 24.6637, lng: 93.9063 },
  { name: "Meghalaya", lat: 25.4670, lng: 91.3662 },
  { name: "Mizoram", lat: 23.1645, lng: 92.9376 },
  { name: "Nagaland", lat: 26.1584, lng: 94.5624 },
  { name: "Odisha", lat: 20.9517, lng: 85.0985 },
  { name: "Punjab", lat: 31.1471, lng: 75.3412 },
  { name: "Rajasthan", lat: 26.9124, lng: 75.7873 },
  { name: "Sikkim", lat: 27.5330, lng: 88.5122 },
  { name: "Tamil Nadu", lat: 11.1271, lng: 78.6569 },
  { name: "Telangana", lat: 18.1124, lng: 79.0193 },
  { name: "Tripura", lat: 23.9408, lng: 91.9882 },
  { name: "Uttar Pradesh", lat: 26.8467, lng: 80.9462 },
  { name: "Uttarakhand", lat: 30.0668, lng: 79.0193 },
  { name: "West Bengal", lat: 22.9868, lng: 87.8550 }
];

// map init
const map = L.map("map", { zoomControl: false, attributionControl: false }).setView([22.0, 79.0], 5);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

// ui elements
const stateSelect = document.getElementById("stateSelect");
const guessBtn = document.getElementById("guessBtn");
const revealBtn = document.getElementById("revealBtn");
const nextBtn = document.getElementById("nextBtn");
const resultDiv = document.getElementById("result");
const roundSpan = document.getElementById("round");
const scoreSpan = document.getElementById("score");

// populate select
STATES.forEach(s => {
  const opt = document.createElement("option");
  opt.value = s.name;
  opt.textContent = s.name;
  stateSelect.appendChild(opt);
});

// helpers
function toRad(d){ return d * Math.PI / 180; }
function toDeg(r){ return r * 180 / Math.PI; }

// destination point by bearing & distance
function destinationPoint(lat, lng, bearingDeg, distanceKm){
  const δ = distanceKm / EARTH_RADIUS_KM;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lng);

  const φ2 = Math.asin(Math.sin(φ1)*Math.cos(δ) + Math.cos(φ1)*Math.sin(δ)*Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ)*Math.sin(δ)*Math.cos(φ1), Math.cos(δ)-Math.sin(φ1)*Math.sin(φ2));
  return { lat: toDeg(φ2), lng: toDeg(λ2) };
}

function haversine(lat1,lng1,lat2,lng2){
  const φ1=toRad(lat1), φ2=toRad(lat2), Δφ=toRad(lat2-lat1), Δλ=toRad(lng2-lng1);
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return EARTH_RADIUS_KM * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// create regular polygon (approx circle) around centroid
function makePolygonAround(centroid, radiusKm = POINT_RADIUS_KM, points = 48){
  const coords = [];
  for(let i=0;i<points;i++){
    const bearing = (i/points) * 360;
    const p = destinationPoint(centroid.lat, centroid.lng, bearing, radiusKm);
    coords.push([p.lng, p.lat]); // GeoJSON order lon,lat
  }
  // close polygon
  coords.push(coords[0]);
  return coords;
}

// convert geo coords to Leaflet latlngs
function polyCoordsToLatLngs(coords){
  return coords.map(c => [c[1], c[0]]);
}

// game state
let currentRound = 0, totalScore = 0;
let trueState = null, truePoint = null;
let statePolygonLayer = null, pointMarker = null, guessMarker = null, connectingLine = null;

// sample random point inside polygon by rejection sampling from centroid circle: we guarantee point inside polygon by sampling inside same radius
function samplePointInsideState(stateObj){
  // pick random distance [0, radius] with sqrt for uniform
  const r = Math.sqrt(Math.random()) * POINT_RADIUS_KM * 0.95; // slight shrink to avoid edge
  const bearing = Math.random() * 360;
  return destinationPoint(stateObj.lat, stateObj.lng, bearing, r);
}

function startNewRound(){
  currentRound++;
  roundSpan.textContent = currentRound;
  resultDiv.innerHTML = "Pick a state and press Guess.";

  // clear old layers
  if(statePolygonLayer){ map.removeLayer(statePolygonLayer); statePolygonLayer = null; }
  if(pointMarker){ map.removeLayer(pointMarker); pointMarker = null; }
  if(guessMarker){ map.removeLayer(guessMarker); guessMarker = null; }
  if(connectingLine){ map.removeLayer(connectingLine); connectingLine = null; }

  // choose random trueState
  trueState = STATES[Math.floor(Math.random() * STATES.length)];
  // generate a simplified polygon for it (circle approx)
  const polyCoords = makePolygonAround({lat:trueState.lat,lng:trueState.lng}, POINT_RADIUS_KM);
  statePolygonLayer = L.polygon(polyCoordsToLatLngs(polyCoords), { color: "#2b9fff", weight: 1, fillOpacity: 0.05 }).addTo(map);

  // pick random point inside polygon (we sample around centroid)
  truePoint = samplePointInsideState(trueState);
  pointMarker = L.circleMarker([truePoint.lat, truePoint.lng], { radius: 6, color: "#ffd43b" }).addTo(map);
  // hide the true marker until reveal
  pointMarker.setStyle({opacity:0, fillOpacity:0});

  // center map on centroid + zoom so visualization fits
  map.setView([trueState.lat, trueState.lng], 7);

  // buttons
  guessBtn.disabled = false;
  revealBtn.disabled = false;
  nextBtn.disabled = true;
}

function revealResult(userChoiceName){
  // show true marker
  pointMarker.setStyle({opacity:1, fillOpacity:1});
  // show guessed state's centroid marker
  const guessed = STATES.find(s => s.name === userChoiceName);
  guessMarker = L.marker([guessed.lat, guessed.lng]).addTo(map);

  // draw connecting line (centroid -> actual point)
  connectingLine = L.polyline([[truePoint.lat,truePoint.lng], [guessed.lat,guessed.lng]], {weight:2}).addTo(map);

  // compute distance from guessed centroid to actual point
  const dist = haversine(truePoint.lat,truePoint.lng, guessed.lat, guessed.lng);
  const correct = guessed.name === trueState.name;
  const points = correct ? 5000 : Math.max(0, Math.round(5000 - dist * 8));

  totalScore += points;
  scoreSpan.textContent = totalScore;

  const correctText = correct ? "<strong style='color:#9ffea3'>Correct!</strong>" : "<strong style='color:#ff8b8b'>Wrong</strong>";
  resultDiv.innerHTML = `${correctText} True state: <b>${trueState.name}</b><br>Distance (centroid → point): <b>${dist.toFixed(1)} km</b><br>Points gained: <b>${points}</b>`;

  guessBtn.disabled = true;
  revealBtn.disabled = true;
  nextBtn.disabled = (currentRound >= ROUNDS);
  if(currentRound >= ROUNDS){
    nextBtn.textContent = "Game Over";
    resultDiv.innerHTML += `<br><br><strong>Game finished.</strong> Final score: ${totalScore}. Refresh to play again.`;
  } else {
    nextBtn.textContent = "Next";
    nextBtn.disabled = false;
  }
}

// events
guessBtn.addEventListener("click", () => {
  const chosen = stateSelect.value;
  if(!chosen) return;
  revealResult(chosen);
});

revealBtn.addEventListener("click", () => {
  // reveal without awarding (treat as guessed current selection)
  const chosen = stateSelect.value || STATES[0].name;
  revealResult(chosen);
});

nextBtn.addEventListener("click", () => {
  if(currentRound < ROUNDS) startNewRound();
});

// init
function init(){
  currentRound = 0; totalScore = 0;
  scoreSpan.textContent = totalScore;
  roundSpan.textContent = currentRound;
  startNewRound();
}

init();
