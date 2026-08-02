const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

function calculateTollCost(route) {
    if (!route.details || !route.details.toll || !route.details.distance) return 0;
    let tollDistanceMeters = 0;
    route.details.distance.forEach(distSegment => {
        const [dStart, dEnd, distance] = distSegment;
        const isToll = route.details.toll.some(t => {
            const [tStart, tEnd, tValue] = t;
            return (Math.max(dStart, tStart) < Math.min(dEnd, tEnd)) && tValue === "all"; 
        });
        if (isToll) tollDistanceMeters += distance;
    });
    return (tollDistanceMeters / 1000) * 0.12; 
}

async function getRoute(start, end, tollPenalty) {
    try {
        const response = await axios.post('http://100.121.54.98:8989/route', {
            points: [start, end],
            profile: "car",
            elevation: false,
            "ch.disable": true,
            details: ["toll", "distance"], 
            points_encoded: false, // Indispensable pour avoir le tracé détaillé
            instructions: true, // Nécessaire pour le guidage vocal
            locale: "fr", // Instructions en français
            custom_model: {
                distance_influence: 15,
                priority: [{ "if": "toll == ALL", "multiply_by": tollPenalty }]
            }
        });
        
        const route = response.data.paths[0];
        return {
            timeMinutes: route.time / 1000 / 60,
            distanceKm: route.distance / 1000,
            tollCost: calculateTollCost(route),
            // 🚨 CORRECTION 1 : On encapsule le tracé dans un vrai GeoJSON Feature
            geometry: {
                type: "Feature",
                properties: {},
                geometry: route.points
            },
            // Étapes de navigation pour le guidage vocal (position = index dans geometry.geometry.coordinates)
            instructions: (route.instructions || []).map(instr => ({
                text: instr.text,
                distance: instr.distance,
                time: instr.time,
                sign: instr.sign,
                interval: instr.interval,
                streetName: instr.street_name || ""
            })),
            penaltyUsed: tollPenalty
        };
    } catch (error) {
        return null; 
    }
}

app.post('/api/calculer-trajets', async (req, res) => {
    const { start, end, budget } = req.body;
    
    const fastestRoute = await getRoute(start, end, 1.0);
    const freeRoute = await getRoute(start, end, 0.05);
    
    let budgetRoute = null;
    if (fastestRoute && fastestRoute.tollCost <= budget) {
        budgetRoute = fastestRoute;
    } else {
        let penalty = 0.9; 
        while (penalty >= 0.05) {
            let route = await getRoute(start, end, penalty);
            if (route && route.tollCost <= budget) {
                budgetRoute = route;
                break; 
            }
            penalty -= 0.1; 
        }
        if (!budgetRoute && freeRoute && freeRoute.tollCost <= budget) {
            budgetRoute = freeRoute;
        }
    }

    res.json({ rapide: fastestRoute, budget: budgetRoute, gratuit: freeRoute });
});

app.listen(3000, () => {
    console.log("🚀 Backend prêt avec tracés détaillés sur http://localhost:3000");
});