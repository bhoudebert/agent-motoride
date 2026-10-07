# Ride Feedback: delta

## MODIFIED Requirements

### Requirement: Notes during the ride

The system SHALL accept a note on a ride from every mode: free text, an
optional rating from 0 (never again) to 5, and a look-back window in minutes
(default 10), stored with the time it was given. Without an explicit ride, the
note SHALL attach to the ride dated today, else to the most recent ride.

### Requirement: Review with a recorded track

As today, for a ride and its track; the track SHALL be stored on the ride, the
ride marked ridden, and confirmed road ratings stored on its roadbook.
