# Item passport

The item page and `GET /api/assets/:id/passport` show recorded lease lives in chronological order. The public response includes prices and asset readings. It omits participant names, participant IDs and contract references.

- A new signing records the asset's condition and counter in its audit row. Earlier signings with no reading show an unknown starting state. Earlier seed lives contribute to the count.
- Returns use the latest inspection, and refurbishment uses the recorded work and the data pack's cost rules. Service costs need the inspected hours since service. The known total excludes steps with an unknown cost.
- Carbon figures are estimates from the existing circular-use method. Each estimate uses the signing reading and known prior counter resets. Lives with missing readings contribute to the life count and are omitted from the estimated carbon total.
