// GENERATED FILE (tools/embed-data.js). Do not edit by hand: edit the .json files and regenerate.
globalThis.EMBEDDED_DATA = {
  "geometry": {
    "note": "PROVISIONAL GEOMETRY. Angles, lanes, radii and names are approximate and must be replaced with the field sketch. angle_deg: 0 = east, 90 = north, 180 = west, 270 = south. Roundabouts circulate counterclockwise (right-hand traffic). Display names are in Spanish because they appear in the UI.",
    "lane_width_m": 3.5,
    "active_site": "la_lucha",
    "sites": {
      "la_lucha": {
        "name": "Intercambiador de La Lucha (glorieta a nivel)",
        "coordinates": null,
        "radius_m": 28,
        "ring_lanes": 2,
        "approaches": [
          {
            "id": "north",
            "name": "Acceso norte (vía por verificar)",
            "angle_deg": 90,
            "lanes_in": 2,
            "lanes_out": 2,
            "approach_length_m": 110,
            "exit_length_m": 70,
            "exit_capacity_vph": {
              "peak": 1500,
              "offpeak": 2400
            }
          },
          {
            "id": "east",
            "name": "Acceso oriente (vía por verificar)",
            "angle_deg": 0,
            "lanes_in": 1,
            "lanes_out": 1,
            "approach_length_m": 90,
            "exit_length_m": 60,
            "exit_capacity_vph": {
              "peak": 900,
              "offpeak": 1500
            }
          },
          {
            "id": "south",
            "name": "Acceso sur (vía por verificar)",
            "angle_deg": 270,
            "lanes_in": 2,
            "lanes_out": 2,
            "approach_length_m": 110,
            "exit_length_m": 70,
            "exit_capacity_vph": {
              "peak": 450,
              "offpeak": 2400
            }
          },
          {
            "id": "west",
            "name": "Acceso occidente (vía por verificar)",
            "angle_deg": 180,
            "lanes_in": 1,
            "lanes_out": 1,
            "approach_length_m": 90,
            "exit_length_m": 60,
            "exit_capacity_vph": {
              "peak": 900,
              "offpeak": 1500
            }
          }
        ],
        "signal_phases": [
          [
            "north",
            "south"
          ],
          [
            "east",
            "west"
          ]
        ]
      },
      "mamatoco": {
        "name": "Glorieta de Mamatoco",
        "coordinates": null,
        "radius_m": 22,
        "ring_lanes": 2,
        "approaches": [
          {
            "id": "north",
            "name": "Acceso norte (vía por verificar)",
            "angle_deg": 80,
            "lanes_in": 1,
            "lanes_out": 1,
            "approach_length_m": 90,
            "exit_length_m": 60,
            "exit_capacity_vph": null
          },
          {
            "id": "east",
            "name": "Acceso oriente (vía por verificar)",
            "angle_deg": 350,
            "lanes_in": 2,
            "lanes_out": 2,
            "approach_length_m": 100,
            "exit_length_m": 70,
            "exit_capacity_vph": null
          },
          {
            "id": "south",
            "name": "Acceso sur (vía por verificar)",
            "angle_deg": 260,
            "lanes_in": 1,
            "lanes_out": 1,
            "approach_length_m": 90,
            "exit_length_m": 60,
            "exit_capacity_vph": null
          },
          {
            "id": "west",
            "name": "Acceso occidente (vía por verificar)",
            "angle_deg": 170,
            "lanes_in": 2,
            "lanes_out": 2,
            "approach_length_m": 100,
            "exit_length_m": 70,
            "exit_capacity_vph": {
              "peak": 1200,
              "offpeak": 2000
            }
          }
        ],
        "signal_phases": [
          [
            "north",
            "south"
          ],
          [
            "east",
            "west"
          ]
        ]
      },
      "la_piragua": {
        "name": "Glorieta La Piragua (en obra)",
        "under_construction": true,
        "coordinates": null,
        "radius_m": 32,
        "ring_lanes": 2,
        "approaches": [
          {
            "id": "north",
            "name": "Acceso norte (vía por verificar)",
            "angle_deg": 95,
            "lanes_in": 2,
            "lanes_out": 2,
            "approach_length_m": 110,
            "exit_length_m": 70,
            "exit_capacity_vph": null
          },
          {
            "id": "east",
            "name": "Acceso oriente (vía por verificar)",
            "angle_deg": 10,
            "lanes_in": 2,
            "lanes_out": 2,
            "approach_length_m": 110,
            "exit_length_m": 70,
            "exit_capacity_vph": null
          },
          {
            "id": "south",
            "name": "Acceso sur (vía por verificar)",
            "angle_deg": 265,
            "lanes_in": 2,
            "lanes_out": 2,
            "approach_length_m": 110,
            "exit_length_m": 70,
            "exit_capacity_vph": {
              "peak": 1400,
              "offpeak": 2400
            }
          },
          {
            "id": "west",
            "name": "Acceso occidente (vía por verificar)",
            "angle_deg": 185,
            "lanes_in": 1,
            "lanes_out": 1,
            "approach_length_m": 90,
            "exit_length_m": 60,
            "exit_capacity_vph": null
          }
        ],
        "signal_phases": [
          [
            "north",
            "south"
          ],
          [
            "east",
            "west"
          ]
        ]
      }
    }
  },
  "counts": {
    "note": "TEST DATA (made up). Replace with the real 15-minute counts per approach and vehicle type. turning = share of vehicles from each approach that leave through each exit (estimate it from the video).",
    "sites": {
      "la_lucha": {
        "site": "Intercambiador de La Lucha",
        "is_test_data": true,
        "coordinates": null,
        "profiles": {
          "peak": {
            "time": "17:15-17:30",
            "approaches": {
              "north": {
                "motorcycle": 134,
                "car": 85,
                "bus": 13
              },
              "east": {
                "motorcycle": 73,
                "car": 42,
                "bus": 6
              },
              "south": {
                "motorcycle": 123,
                "car": 76,
                "bus": 10
              },
              "west": {
                "motorcycle": 62,
                "car": 35,
                "bus": 4
              }
            }
          },
          "offpeak": {
            "time": "10:00-10:15",
            "approaches": {
              "north": {
                "motorcycle": 41,
                "car": 30,
                "bus": 5
              },
              "east": {
                "motorcycle": 22,
                "car": 14,
                "bus": 2
              },
              "south": {
                "motorcycle": 37,
                "car": 26,
                "bus": 4
              },
              "west": {
                "motorcycle": 19,
                "car": 11,
                "bus": 2
              }
            }
          }
        },
        "turning": {
          "north": {
            "east": 0.2,
            "south": 0.6,
            "west": 0.17,
            "north": 0.03
          },
          "east": {
            "south": 0.3,
            "west": 0.4,
            "north": 0.28,
            "east": 0.02
          },
          "south": {
            "west": 0.2,
            "north": 0.6,
            "east": 0.17,
            "south": 0.03
          },
          "west": {
            "north": 0.3,
            "east": 0.4,
            "south": 0.28,
            "west": 0.02
          }
        },
        "observed_blockages": []
      },
      "mamatoco": {
        "site": "Glorieta de Mamatoco",
        "is_test_data": true,
        "coordinates": null,
        "profiles": {
          "peak": {
            "time": "17:15-17:30",
            "approaches": {
              "north": {
                "motorcycle": 60,
                "car": 32,
                "bus": 6
              },
              "east": {
                "motorcycle": 85,
                "car": 50,
                "bus": 8
              },
              "south": {
                "motorcycle": 55,
                "car": 28,
                "bus": 5
              },
              "west": {
                "motorcycle": 90,
                "car": 52,
                "bus": 9
              }
            }
          },
          "offpeak": {
            "time": "10:00-10:15",
            "approaches": {
              "north": {
                "motorcycle": 25,
                "car": 14,
                "bus": 3
              },
              "east": {
                "motorcycle": 38,
                "car": 22,
                "bus": 4
              },
              "south": {
                "motorcycle": 22,
                "car": 12,
                "bus": 2
              },
              "west": {
                "motorcycle": 40,
                "car": 24,
                "bus": 4
              }
            }
          }
        },
        "turning": {
          "north": {
            "east": 0.3,
            "south": 0.35,
            "west": 0.33,
            "north": 0.02
          },
          "east": {
            "south": 0.2,
            "west": 0.6,
            "north": 0.18,
            "east": 0.02
          },
          "south": {
            "west": 0.3,
            "north": 0.35,
            "east": 0.33,
            "south": 0.02
          },
          "west": {
            "north": 0.2,
            "east": 0.6,
            "south": 0.18,
            "west": 0.02
          }
        },
        "observed_blockages": []
      },
      "la_piragua": {
        "site": "Glorieta La Piragua",
        "is_test_data": true,
        "coordinates": null,
        "profiles": {
          "peak": {
            "time": "17:15-17:30",
            "approaches": {
              "north": {
                "motorcycle": 80,
                "car": 55,
                "bus": 8
              },
              "east": {
                "motorcycle": 70,
                "car": 45,
                "bus": 7
              },
              "south": {
                "motorcycle": 85,
                "car": 58,
                "bus": 9
              },
              "west": {
                "motorcycle": 40,
                "car": 22,
                "bus": 3
              }
            }
          },
          "offpeak": {
            "time": "10:00-10:15",
            "approaches": {
              "north": {
                "motorcycle": 35,
                "car": 24,
                "bus": 4
              },
              "east": {
                "motorcycle": 30,
                "car": 20,
                "bus": 3
              },
              "south": {
                "motorcycle": 36,
                "car": 25,
                "bus": 4
              },
              "west": {
                "motorcycle": 17,
                "car": 10,
                "bus": 2
              }
            }
          }
        },
        "turning": {
          "north": {
            "east": 0.25,
            "south": 0.5,
            "west": 0.22,
            "north": 0.03
          },
          "east": {
            "south": 0.35,
            "west": 0.25,
            "north": 0.37,
            "east": 0.03
          },
          "south": {
            "west": 0.2,
            "north": 0.5,
            "east": 0.27,
            "south": 0.03
          },
          "west": {
            "north": 0.35,
            "east": 0.3,
            "south": 0.32,
            "west": 0.03
          }
        },
        "observed_blockages": []
      }
    }
  },
  "parameters": {
    "note": "Typical reference values. The team must review and justify them (for example, timing on the video how long a motorcycle or a car takes to cover a known stretch).",
    "vehicles": {
      "motorcycle": {
        "length_m": 2,
        "width_m": 0.8,
        "max_speed_ms": 11,
        "acceleration_ms2": 3,
        "deceleration_ms2": 5,
        "min_gap_m": 1,
        "critical_gap_s": 2,
        "pce": 0.4
      },
      "car": {
        "length_m": 4.5,
        "width_m": 1.8,
        "max_speed_ms": 9.7,
        "acceleration_ms2": 2,
        "deceleration_ms2": 4.5,
        "min_gap_m": 2,
        "critical_gap_s": 3.2,
        "pce": 1
      },
      "bus": {
        "length_m": 9,
        "width_m": 2.4,
        "max_speed_ms": 8.3,
        "acceleration_ms2": 1.2,
        "deceleration_ms2": 3.5,
        "min_gap_m": 2.5,
        "critical_gap_s": 4,
        "pce": 2
      }
    },
    "roundabout": {
      "max_speed_ms": 7,
      "aggressiveness_factor": 0.4,
      "ring_stop_distance_m": 10
    },
    "signal": {
      "green_s": [
        30,
        20
      ],
      "yellow_s": 3,
      "all_red_s": 2
    },
    "officer": {
      "turn_s": 40,
      "transition_s": 6,
      "prevent_blocking": true,
      "groups": {},
      "groups_note": "Optional. Example: \"groups\": { \"la_lucha\": [[\"north\",\"south\"],[\"east\",\"west\"]] } if the officer lets two opposite approaches go at the same time."
    },
    "simulation": {
      "step_s": 0.1,
      "seed": 2026,
      "max_duration_s": 3600,
      "comparison_duration_s": 900,
      "arrival_mode": "exact_count"
    },
    "test_case": [
      {
        "t": 0,
        "approach": "east",
        "type": "car",
        "destination": "west"
      },
      {
        "t": 2,
        "approach": "east",
        "type": "car",
        "destination": "west"
      },
      {
        "t": 4,
        "approach": "east",
        "type": "car",
        "destination": "west"
      }
    ]
  }
};
