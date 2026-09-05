// Сгенерировано из docs/API_CONTRACT.md § 5 (первый и второй ```json-блоки), не править руками.
// Обновить: UPDATE_CONTRACT=1 npx jest --selectProjects core contract
// route.points сокращён так же, как в § 5 (см. __tests__/core/contract.test.ts).
import type { PlanResult, TripInput } from '../../src/core';

export const TRIP_INPUT: TripInput = {
  "origin": {
    "lat": 52.2297,
    "lon": 21.0122
  },
  "destination": {
    "lat": 50.1109,
    "lon": 8.6821
  },
  "departureAt": "2026-09-07T06:00:00+02:00",
  "vehicleWeightKg": 40000
};

export const LABELS = {"originName":"Варшава","destinationName":"Франкфурт"};

export const OK_RESULT: Extract<PlanResult, { status: 'ok' }> = {
  "status": "ok",
  "departureAt": "2026-09-07T06:00:00+02:00",
  "arrivalAt": "2026-09-07T14:24:21.000Z",
  "drivingTimeSec": 32061,
  "stops": [
    {
      "parking": {
        "id": "mock-5fc8bd88-1",
        "name": "Mock parking 5FC8-1",
        "lat": 51.270353,
        "lon": 15.127847,
        "capacityTotal": 57,
        "freeAt": 27,
        "confidence": 0.6
      },
      "arrivalAt": "2026-09-07T08:11:15.000Z",
      "departAt": "2026-09-07T08:56:15.000Z",
      "pauseSec": 2700,
      "drivingSecFromPrev": 15075
    },
    {
      "parking": {
        "id": "mock-481aea79-1",
        "name": "Mock parking 481A-1",
        "lat": 50.257708,
        "lon": 9.424686,
        "capacityTotal": 38,
        "freeAt": 13,
        "confidence": 0.6
      },
      "arrivalAt": "2026-09-07T13:06:09.000Z",
      "departAt": "2026-09-07T13:51:09.000Z",
      "pauseSec": 2700,
      "drivingSecFromPrev": 14994
    }
  ],
  "requiresDailyRest": false,
  "route": {
    "points": [
      {
        "lat": 52.2297,
        "lon": 21.0122
      },
      {
        "lat": 52.218279,
        "lon": 20.942148
      },
      {
        "lat": 52.206858,
        "lon": 20.872096
      },
      {
        "lat": 50.1109,
        "lon": 8.6821
      }
    ]
  }
};

export const CONFLICT_RESULT: Extract<PlanResult, { status: 'conflict' }> = {
  "status": "conflict",
  "conflict": {
    "code": "no-free-parking",
    "reason": "No free parking within 25 km of the planned break point (51.226587, 15.174708) at 2026-09-07T08:10:00.000Z.",
    "anchor": {
      "lat": 51.226587,
      "lon": 15.174708,
      "plannedArrivalAt": "2026-09-07T08:10:00.000Z",
      "drivenSecFromPrev": 15000,
      "drivenSecFromStart": 15000
    }
  }
};
