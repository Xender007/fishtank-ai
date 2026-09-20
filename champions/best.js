// Best validated display brain. Written by train.js.
window.CHAMPION = {
  "version": 1,
  "saved": "2026-09-20T23:39:02.863Z",
  "meta": {
    "generation": 15,
    "totalGenerations": 325,
    "benchmark": 38.816874999999,
    "evaluation": "{\"regime\":\"social-v2\",\"clones\":12,\"seconds\":45,\"dt\":0.016666666666666666,\"fish\":{\"speed\":90,\"turn\":3,\"radius\":5},\"shark\":{\"count\":2,\"radius\":16,\"maxSpeed\":105,\"turnRate\":1.6,\"circleLimit\":3,\"circleBreakSeconds\":1.4},\"tank\":{\"w\":900,\"h\":600},\"senses\":{\"rayCount\":9,\"fov\":5.759586531581287,\"range\":170,\"wallRange\":130,\"neighbours\":false,\"neighbourRange\":150,\"crowdScale\":3},\"schooling\":{\"enabled\":true,\"minSize\":7,\"targetSize\":9,\"spacing\":24,\"alarmRange\":150,\"memorySeconds\":2.5,\"scoutRange\":260,\"followerRange\":170,\"nearSense\":65,\"planEvery\":6,\"predictionSteps\":10,\"predictionDt\":0.12,\"routeSteps\":16,\"dodgeSteps\":4}}",
    "clones": 12,
    "params": 31,
    "hidden": 2,
    "displayBenchmark": 54.20379629629448,
    "displayEvaluation": "{\"regime\":\"social-v2\",\"clones\":45,\"seconds\":60,\"dt\":0.016666666666666666,\"fish\":{\"speed\":90,\"turn\":3,\"radius\":5},\"shark\":{\"count\":2,\"radius\":16,\"maxSpeed\":105,\"turnRate\":1.6,\"circleLimit\":3,\"circleBreakSeconds\":1.4},\"tank\":{\"w\":900,\"h\":600},\"senses\":{\"rayCount\":9,\"fov\":5.759586531581287,\"range\":170,\"wallRange\":130,\"neighbours\":false,\"neighbourRange\":150,\"crowdScale\":3},\"schooling\":{\"enabled\":true,\"minSize\":7,\"targetSize\":9,\"spacing\":24,\"alarmRange\":150,\"memorySeconds\":2.5,\"scoutRange\":260,\"followerRange\":170,\"nearSense\":65,\"planEvery\":6,\"predictionSteps\":10,\"predictionDt\":0.12,\"routeSteps\":16,\"dodgeSteps\":4},\"seedBase\":7300001,\"runs\":12}",
    "displayClones": 45,
    "displaySeconds": 60,
    "trainingTotalGenerations": 380
  },
  "kind": "genome",
  "hue": 278.7109826831146,
  "nodes": [
    {
      "id": 0,
      "type": 0,
      "bias": 0
    },
    {
      "id": 1,
      "type": 0,
      "bias": 0
    },
    {
      "id": 2,
      "type": 0,
      "bias": 0
    },
    {
      "id": 3,
      "type": 0,
      "bias": 0
    },
    {
      "id": 4,
      "type": 0,
      "bias": 0
    },
    {
      "id": 5,
      "type": 0,
      "bias": 0
    },
    {
      "id": 6,
      "type": 0,
      "bias": 0
    },
    {
      "id": 7,
      "type": 0,
      "bias": 0
    },
    {
      "id": 8,
      "type": 0,
      "bias": 0
    },
    {
      "id": 9,
      "type": 0,
      "bias": 0
    },
    {
      "id": 10,
      "type": 0,
      "bias": 0
    },
    {
      "id": 11,
      "type": 0,
      "bias": 0
    },
    {
      "id": 12,
      "type": 1,
      "bias": -0.2728760354206012
    },
    {
      "id": 13,
      "type": 1,
      "bias": 0.10327858990058303
    },
    {
      "id": 15,
      "type": 2,
      "bias": 0.415960441471998
    },
    {
      "id": 19,
      "type": 2,
      "bias": 0
    }
  ],
  "conns": [
    {
      "inn": 0,
      "from": 0,
      "to": 12,
      "recurrent": false,
      "plasticity": 0.19193977914745883,
      "w": -0.1712177589474065,
      "enabled": true
    },
    {
      "inn": 1,
      "from": 0,
      "to": 13,
      "recurrent": false,
      "plasticity": -0.12813246506428896,
      "w": 0.9521159318339286,
      "enabled": false
    },
    {
      "inn": 2,
      "from": 1,
      "to": 12,
      "recurrent": false,
      "plasticity": 0,
      "w": 0.1703230490820164,
      "enabled": true
    },
    {
      "inn": 3,
      "from": 1,
      "to": 13,
      "recurrent": false,
      "plasticity": 0,
      "w": -0.1432668553081652,
      "enabled": false
    },
    {
      "inn": 4,
      "from": 2,
      "to": 12,
      "recurrent": false,
      "plasticity": -0.16873088182761692,
      "w": 0.37896670362855883,
      "enabled": true
    },
    {
      "inn": 5,
      "from": 2,
      "to": 13,
      "recurrent": false,
      "plasticity": 0.09632812106918244,
      "w": 0.008050855729611534,
      "enabled": true
    },
    {
      "inn": 6,
      "from": 3,
      "to": 12,
      "recurrent": false,
      "plasticity": -0.39292250740595536,
      "w": -0.5521085442013653,
      "enabled": true
    },
    {
      "inn": 7,
      "from": 3,
      "to": 13,
      "recurrent": false,
      "plasticity": -0.030678355258509184,
      "w": 0.6609380835635954,
      "enabled": true
    },
    {
      "inn": 8,
      "from": 4,
      "to": 12,
      "recurrent": false,
      "plasticity": 0,
      "w": 0.18819322325676502,
      "enabled": true
    },
    {
      "inn": 9,
      "from": 4,
      "to": 13,
      "recurrent": false,
      "plasticity": 0,
      "w": 0.3715195022372942,
      "enabled": true
    },
    {
      "inn": 10,
      "from": 5,
      "to": 12,
      "recurrent": false,
      "plasticity": 0,
      "w": -0.22944424884270045,
      "enabled": true
    },
    {
      "inn": 11,
      "from": 5,
      "to": 13,
      "recurrent": false,
      "plasticity": 0,
      "w": -0.08310787826863439,
      "enabled": true
    },
    {
      "inn": 12,
      "from": 6,
      "to": 12,
      "recurrent": false,
      "plasticity": 0,
      "w": -0.14279430997170098,
      "enabled": true
    },
    {
      "inn": 13,
      "from": 6,
      "to": 13,
      "recurrent": false,
      "plasticity": -0.11749786447547926,
      "w": 0.4504813099244007,
      "enabled": true
    },
    {
      "inn": 14,
      "from": 7,
      "to": 12,
      "recurrent": false,
      "plasticity": -0.09053533847456671,
      "w": -0.07116328202286175,
      "enabled": true
    },
    {
      "inn": 15,
      "from": 7,
      "to": 13,
      "recurrent": false,
      "plasticity": 0,
      "w": 0.172903922037908,
      "enabled": true
    },
    {
      "inn": 16,
      "from": 8,
      "to": 12,
      "recurrent": false,
      "plasticity": -0.04939245750253043,
      "w": -0.6827104552404246,
      "enabled": true
    },
    {
      "inn": 17,
      "from": 8,
      "to": 13,
      "recurrent": false,
      "plasticity": -0.05135147527309891,
      "w": -0.5378610824123253,
      "enabled": true
    },
    {
      "inn": 18,
      "from": 9,
      "to": 12,
      "recurrent": false,
      "plasticity": -0.09829927142956897,
      "w": -0.09384179166003742,
      "enabled": true
    },
    {
      "inn": 19,
      "from": 9,
      "to": 13,
      "recurrent": false,
      "plasticity": -0.1617579515072823,
      "w": 0.2400154520481233,
      "enabled": true
    },
    {
      "inn": 20,
      "from": 10,
      "to": 12,
      "recurrent": false,
      "plasticity": 0,
      "w": 0.5658725464549492,
      "enabled": true
    },
    {
      "inn": 21,
      "from": 10,
      "to": 13,
      "recurrent": false,
      "plasticity": 0,
      "w": -0.25494007863769685,
      "enabled": true
    },
    {
      "inn": 22,
      "from": 11,
      "to": 12,
      "recurrent": false,
      "plasticity": 0.2889687287827737,
      "w": -0.07550461536907349,
      "enabled": true
    },
    {
      "inn": 23,
      "from": 11,
      "to": 13,
      "recurrent": false,
      "plasticity": -0.08459696839258492,
      "w": -0.564437825944676,
      "enabled": true
    },
    {
      "inn": 26,
      "from": 1,
      "to": 15,
      "recurrent": false,
      "plasticity": -0.0973921184770652,
      "w": 1,
      "enabled": true
    },
    {
      "inn": 27,
      "from": 15,
      "to": 13,
      "recurrent": false,
      "plasticity": -0.012030169611343358,
      "w": 0.24781249465302457,
      "enabled": true
    },
    {
      "inn": 35,
      "from": 8,
      "to": 15,
      "recurrent": false,
      "plasticity": 0,
      "w": -0.7310374075573253,
      "enabled": true
    },
    {
      "inn": 40,
      "from": 0,
      "to": 19,
      "recurrent": false,
      "plasticity": 0,
      "w": 1,
      "enabled": true
    },
    {
      "inn": 41,
      "from": 19,
      "to": 13,
      "recurrent": false,
      "plasticity": 0,
      "w": 0.37124361720967447,
      "enabled": true
    }
  ]
};
