-- Full reset + target schema based on coursework model.
-- WARNING: destructive by design (breaking_rebuild mode).

BEGIN;

DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS seats CASCADE;
DROP TABLE IF EXISTS flights CASCADE;
DROP TABLE IF EXISTS aircrafts CASCADE;
DROP TABLE IF EXISTS airports CASCADE;
DROP TABLE IF EXISTS airlines CASCADE;
DROP TABLE IF EXISTS passengers CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(100) NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE airlines (
  airline_id SERIAL PRIMARY KEY,
  airline_name VARCHAR(100) NOT NULL,
  country VARCHAR(50) NOT NULL,
  contact_phone VARCHAR(20),
  email VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
);

CREATE TABLE aircrafts (
  aircraft_id SERIAL PRIMARY KEY,
  aircraft_type VARCHAR(50) NOT NULL,
  registration_number VARCHAR(20) NOT NULL UNIQUE,
  airline_id INTEGER NOT NULL REFERENCES airlines(airline_id) ON DELETE RESTRICT,
  total_seats INTEGER NOT NULL CHECK (total_seats > 0),
  business_seats INTEGER NOT NULL DEFAULT 0,
  economy_seats INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
);

CREATE TABLE airports (
  airport_id SERIAL PRIMARY KEY,
  airport_name VARCHAR(100) NOT NULL,
  city VARCHAR(50) NOT NULL,
  country VARCHAR(50) NOT NULL
);

CREATE TABLE flights (
  flight_id SERIAL PRIMARY KEY,
  flight_number VARCHAR(10) NOT NULL UNIQUE,
  airline_id INTEGER NOT NULL REFERENCES airlines(airline_id) ON DELETE RESTRICT,
  aircraft_id INTEGER NOT NULL REFERENCES aircrafts(aircraft_id) ON DELETE RESTRICT,
  departure_airport_id INTEGER NOT NULL REFERENCES airports(airport_id) ON DELETE RESTRICT,
  arrival_airport_id INTEGER NOT NULL REFERENCES airports(airport_id) ON DELETE RESTRICT,
  scheduled_departure TIMESTAMP NOT NULL,
  scheduled_arrival TIMESTAMP NOT NULL,
  base_price DECIMAL(10,2) NOT NULL CHECK (base_price >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
);

CREATE TABLE passengers (
  passenger_id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  date_of_birth DATE,
  document_type VARCHAR(20),
  document_number VARCHAR(20),
  phone_number VARCHAR(20),
  email VARCHAR(100)
);

CREATE TABLE seats (
  seat_id SERIAL PRIMARY KEY,
  flight_id INTEGER NOT NULL REFERENCES flights(flight_id) ON DELETE CASCADE,
  seat_number VARCHAR(4) NOT NULL,
  seat_class VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  UNIQUE (flight_id, seat_number)
);

CREATE TABLE bookings (
  booking_id SERIAL PRIMARY KEY,
  booking_reference VARCHAR(6) NOT NULL UNIQUE,
  passenger_id INTEGER NOT NULL REFERENCES passengers(passenger_id) ON DELETE RESTRICT,
  flight_id INTEGER NOT NULL REFERENCES flights(flight_id) ON DELETE RESTRICT,
  seat_id INTEGER NOT NULL REFERENCES seats(seat_id) ON DELETE RESTRICT,
  booking_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  booking_status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'RUB'
);

CREATE TABLE tickets (
  ticket_id SERIAL PRIMARY KEY,
  ticket_number VARCHAR(13) NOT NULL UNIQUE,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(booking_id) ON DELETE CASCADE,
  passenger_id INTEGER NOT NULL REFERENCES passengers(passenger_id) ON DELETE RESTRICT,
  flight_id INTEGER NOT NULL REFERENCES flights(flight_id) ON DELETE RESTRICT,
  fare_class VARCHAR(20) NOT NULL,
  seat_number VARCHAR(4),
  ticket_status VARCHAR(20) NOT NULL DEFAULT 'issued',
  total_fare DECIMAL(10,2) NOT NULL CHECK (total_fare >= 0)
);

CREATE TABLE payments (
  payment_id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  payment_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
  payment_method VARCHAR(20) NOT NULL,
  payment_status VARCHAR(20) NOT NULL DEFAULT 'completed'
);

CREATE INDEX idx_flights_departure ON flights(departure_airport_id, scheduled_departure);
CREATE INDEX idx_flights_arrival ON flights(arrival_airport_id, scheduled_arrival);
CREATE INDEX idx_bookings_passenger ON bookings(passenger_id);
CREATE INDEX idx_bookings_flight ON bookings(flight_id);
CREATE INDEX idx_tickets_passenger ON tickets(passenger_id);
CREATE INDEX idx_tickets_flight ON tickets(flight_id);
CREATE INDEX idx_seats_flight ON seats(flight_id);
CREATE INDEX idx_seats_flight_class ON seats(flight_id, seat_class);
CREATE INDEX idx_payments_booking ON payments(booking_id);

INSERT INTO airlines (airline_name, country, contact_phone, email, status) VALUES
('Аэрофлот', 'Россия', '+79161234567', 'info@aeroflot.ru', 'active'),
('S7 Airlines', 'Россия', '+79162345678', 'contact@s7.ru', 'active');

INSERT INTO aircrafts (aircraft_type, registration_number, airline_id, total_seats, business_seats, economy_seats, status) VALUES
('Boeing 737-800', 'RA-73651', 1, 12, 4, 8, 'active'),
('Airbus A320', 'RA-73123', 2, 12, 4, 8, 'active');

INSERT INTO airports (airport_name, city, country) VALUES
('Шереметьево', 'Москва', 'Россия'),
('Пулково', 'Санкт-Петербург', 'Россия'),
('Стамбул', 'Стамбул', 'Турция'),
('Сочи', 'Сочи', 'Россия');

INSERT INTO flights (
  flight_number, airline_id, aircraft_id, departure_airport_id, arrival_airport_id,
  scheduled_departure, scheduled_arrival, base_price, status
) VALUES
('SU1440', 1, 1, 1, 2, '2026-04-20 08:00:00', '2026-04-20 09:30:00', 5500.00, 'scheduled'),
('S72105', 2, 2, 1, 3, '2026-04-21 13:00:00', '2026-04-21 17:00:00', 13000.00, 'scheduled'),
('SU1111', 1, 1, 1, 4, '2026-04-22 09:00:00', '2026-04-22 12:00:00', 7000.00, 'scheduled');

INSERT INTO seats (flight_id, seat_number, seat_class, status)
SELECT f.flight_id, s.seat_number, s.seat_class, 'available'
FROM flights f
CROSS JOIN (
  VALUES
  ('1A','business'), ('1B','business'), ('1C','business'), ('1D','business'),
  ('2A','economy'), ('2B','economy'), ('2C','economy'), ('2D','economy'),
  ('3A','economy'), ('3B','economy'), ('3C','economy'), ('3D','economy')
) AS s(seat_number, seat_class);

COMMIT;

