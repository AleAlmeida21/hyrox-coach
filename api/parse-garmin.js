// api/parse-garmin.js — Parser de archivos GPX exportados desde Garmin Connect
// Recibe un archivo GPX como texto, extrae los datos del entrenamiento.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { gpxContent } = req.body;
  if (!gpxContent) {
    return res.status(400).json({ error: 'gpxContent requerido' });
  }

  try {
    const result = parseGPX(gpxContent);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: 'Error al parsear GPX', detail: error.message });
  }
}

function parseGPX(xml) {
  // Extraer nombre de la actividad
  const nameMatch = xml.match(/<name>(.*?)<\/name>/);
  const name = nameMatch ? nameMatch[1].trim() : 'Actividad Garmin';

  // Extraer tipo de actividad
  const typeMatch = xml.match(/<type>(.*?)<\/type>/);
  const activityType = typeMatch ? typeMatch[1].toLowerCase() : '';

  // Extraer tiempo (metadata o primer trackpoint)
  const timeMatch = xml.match(/<time>(.*?)<\/time>/);
  let date = new Date().toISOString().split('T')[0];
  let startTime = null;
  if (timeMatch) {
    startTime = new Date(timeMatch[1]);
    date = startTime.toISOString().split('T')[0];
  }

  // Extraer todos los trackpoints
  const trkptMatches = [...xml.matchAll(/<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g)];

  let totalDistance = 0;
  let elevGain = 0;
  let elevLoss = 0;
  let prevEle = null;
  let prevLat = null;
  let prevLon = null;
  let startTs = null;
  let endTs = null;
  let hrSum = 0;
  let hrCount = 0;
  let maxHr = 0;
  let cadSum = 0;
  let cadCount = 0;
  const elevations = [];

  for (const m of trkptMatches) {
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    const inner = m[3];

    // Timestamp
    const tsMatch = inner.match(/<time>(.*?)<\/time>/);
    if (tsMatch) {
      const ts = new Date(tsMatch[1]).getTime();
      if (!startTs) startTs = ts;
      endTs = ts;
    }

    // Elevation
    const eleMatch = inner.match(/<ele>([\d.]+)<\/ele>/);
    if (eleMatch) {
      const ele = parseFloat(eleMatch[1]);
      elevations.push(ele);
      if (prevEle !== null) {
        const diff = ele - prevEle;
        if (diff > 0) elevGain += diff;
        else elevLoss += Math.abs(diff);
      }
      prevEle = ele;
    }

    // Distance (Haversine)
    if (prevLat !== null && prevLon !== null) {
      totalDistance += haversine(prevLat, prevLon, lat, lon);
    }
    prevLat = lat; prevLon = lon;

    // Heart rate
    const hrMatch = inner.match(/<ns3:hr>([\d]+)<\/ns3:hr>|<gpxtpx:hr>([\d]+)<\/gpxtpx:hr>/);
    if (hrMatch) {
      const hr = parseInt(hrMatch[1] || hrMatch[2]);
      hrSum += hr; hrCount++;
      if (hr > maxHr) maxHr = hr;
    }

    // Cadence
    const cadMatch = inner.match(/<ns3:cad>([\d]+)<\/ns3:cad>|<gpxtpx:cad>([\d]+)<\/gpxtpx:cad>/);
    if (cadMatch) {
      cadSum += parseInt(cadMatch[1] || cadMatch[2]);
      cadCount++;
    }
  }

  // Duration in minutes
  const durationMs = (endTs && startTs) ? endTs - startTs : 0;
  const durationMin = Math.round(durationMs / 60000);

  // Map Garmin activity type to app type
  const mappedType = mapActivityType(activityType, name);

  // Pace (min/km)
  let pace = null;
  if (totalDistance > 0.1 && durationMin > 0) {
    const paceRaw = durationMin / totalDistance;
    const paceMin = Math.floor(paceRaw);
    const paceSec = Math.round((paceRaw - paceMin) * 60);
    pace = `${paceMin}:${paceSec.toString().padStart(2,'0')} /km`;
  }

  return {
    name,
    date,
    type: mappedType,
    duration: durationMin,
    distance_km: Math.round(totalDistance * 100) / 100,
    elevation_gain: Math.round(elevGain),
    avg_hr: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
    max_hr: maxHr || null,
    avg_cadence: cadCount > 0 ? Math.round((cadSum / cadCount) * 2) : null, // Garmin stores one-leg cadence
    pace,
    notes: buildNotes({ name, totalDistance, durationMin, elevGain, pace, hrCount, hrSum, maxHr }),
  };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function mapActivityType(garminType, name) {
  const n = (garminType + ' ' + name).toLowerCase();
  if (n.includes('run') || n.includes('corre') || n.includes('jog')) return 'run';
  if (n.includes('row') || n.includes('remo')) return 'row';
  if (n.includes('ski') || n.includes('erg')) return 'skierg';
  if (n.includes('bike') || n.includes('cycle') || n.includes('cycling')) return 'bike';
  if (n.includes('strength') || n.includes('weight') || n.includes('gym')) return 'strength';
  if (n.includes('swim') || n.includes('pool')) return 'mobility';
  if (n.includes('hyrox') || n.includes('pft')) return 'pft';
  if (n.includes('interval')) return 'intervals';
  if (n.includes('tempo')) return 'tempo';
  return 'mixed';
}

function buildNotes({ name, totalDistance, durationMin, elevGain, pace, hrCount, hrSum, maxHr }) {
  const parts = [];
  if (name && name !== 'Actividad Garmin') parts.push(`Actividad: ${name}`);
  if (pace) parts.push(`Ritmo promedio: ${pace}`);
  if (elevGain > 10) parts.push(`Desnivel: +${Math.round(elevGain)}m`);
  if (hrCount > 0) {
    parts.push(`FC promedio: ${Math.round(hrSum/hrCount)} bpm`);
    if (maxHr) parts.push(`FC máxima: ${maxHr} bpm`);
  }
  return parts.join(' · ');
}
