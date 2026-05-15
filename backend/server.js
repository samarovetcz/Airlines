const express = require('express');
const app = express();
require('dotenv').config();
const pool = require('./db');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

const jwtSecret = process.env.JWT_SECRET || 'change_me';

app.use(cors());
app.use(express.json());

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch (_) {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Доступ только для администратора' });
  }
  next();
}

function randomRef(length) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function createUniqueBookingReference(client) {
  for (let i = 0; i < 10; i += 1) {
    const ref = randomRef(6);
    const existing = await client.query('SELECT 1 FROM bookings WHERE booking_reference=$1', [ref]);
    if (existing.rowCount === 0) return ref;
  }
  throw new Error('Не удалось сгенерировать booking reference');
}

async function createUniqueTicketNumber(client) {
  for (let i = 0; i < 10; i += 1) {
    const num = `${Date.now()}${Math.floor(100 + Math.random() * 900)}`.slice(0, 13);
    const existing = await client.query('SELECT 1 FROM tickets WHERE ticket_number=$1', [num]);
    if (existing.rowCount === 0) return num;
  }
  throw new Error('Не удалось сгенерировать ticket number');
}

function buildSeatRows(count, seatClass, startRow = 1) {
  const letters = ['A', 'B', 'C', 'D'];
  const out = [];
  let row = startRow;
  let idx = 0;
  while (idx < count) {
    for (let i = 0; i < letters.length && idx < count; i += 1) {
      out.push({ seat_number: `${row}${letters[i]}`, seat_class: seatClass, status: 'available' });
      idx += 1;
    }
    row += 1;
  }
  return { seats: out, nextRow: row };
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.post('/register', async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, password, first_name, last_name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email и password обязательны' });

    await client.query('BEGIN');
    const hash = await bcrypt.hash(password, 10);
    const userIns = await client.query(
      'INSERT INTO users(email, password) VALUES($1,$2) RETURNING id, email, role',
      [email, hash]
    );

    const user = userIns.rows[0];
    const passengerIns = await client.query(
      `INSERT INTO passengers(user_id, first_name, last_name, email)
       VALUES($1,$2,$3,$4)
       RETURNING passenger_id, first_name, last_name, email`,
      [user.id, first_name || 'Новый', last_name || 'Пользователь', email]
    );
    await client.query('COMMIT');

    res.json({ ok: true, user, passenger: passengerIns.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'Пользователь уже существует' });
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email и password обязательны' });

    const userRes = await pool.query('SELECT id, email, password, role FROM users WHERE email=$1', [email]);
    if (userRes.rowCount === 0) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const user = userRes.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const passengerRes = await pool.query(
      'SELECT passenger_id, first_name, last_name, email FROM passengers WHERE user_id=$1',
      [user.id]
    );
    const passenger = passengerRes.rows[0] || null;

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, passenger_id: passenger?.passenger_id || null },
      jwtSecret,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        passenger_id: passenger?.passenger_id || null,
        first_name: passenger?.first_name || null,
        last_name: passenger?.last_name || null
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/flights', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        f.flight_id, f.flight_number, f.scheduled_departure, f.scheduled_arrival, f.base_price, f.status,
        al.airline_name,
        da.city AS departure_city, da.airport_name AS departure_airport, da.country AS departure_country,
        aa.city AS arrival_city, aa.airport_name AS arrival_airport, aa.country AS arrival_country
      FROM flights f
      JOIN airlines al ON al.airline_id = f.airline_id
      JOIN airports da ON da.airport_id = f.departure_airport_id
      JOIN airports aa ON aa.airport_id = f.arrival_airport_id
      ORDER BY f.scheduled_departure
    `);
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/flights/:flight_id/seats', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT seat_id, seat_number, seat_class, status
       FROM seats
       WHERE flight_id=$1
       ORDER BY seat_number`,
      [req.params.flight_id]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Backward-compatible alias for old frontend route
app.get('/seats/:flight_id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT seat_id, seat_number, seat_class, status
       FROM seats
       WHERE flight_id=$1
       ORDER BY seat_number`,
      [req.params.flight_id]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/bookings', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { flight_id, seat_id, payment_method = 'card' } = req.body || {};
    if (!flight_id || !seat_id) return res.status(400).json({ error: 'flight_id и seat_id обязательны' });

    const passengerRes = await client.query('SELECT passenger_id FROM passengers WHERE user_id=$1', [req.user.id]);
    if (passengerRes.rowCount === 0) return res.status(400).json({ error: 'Профиль пассажира не найден' });
    const passengerId = passengerRes.rows[0].passenger_id;

    await client.query('BEGIN');

    const flightRes = await client.query('SELECT flight_id, base_price FROM flights WHERE flight_id=$1', [flight_id]);
    if (flightRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Рейс не найден' });
    }
    const price = Number(flightRes.rows[0].base_price);

    const seatUpdate = await client.query(
      `UPDATE seats
       SET status='occupied'
       WHERE seat_id=$1 AND flight_id=$2 AND status='available'
       RETURNING seat_id, seat_number, seat_class`,
      [seat_id, flight_id]
    );
    if (seatUpdate.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Место уже занято или не найдено' });
    }
    const seat = seatUpdate.rows[0];

    const bookingReference = await createUniqueBookingReference(client);
    const bookingIns = await client.query(
      `INSERT INTO bookings(booking_reference, passenger_id, flight_id, seat_id, total_amount)
       VALUES($1,$2,$3,$4,$5)
       RETURNING booking_id, booking_reference, booking_status, booking_date, total_amount, currency`,
      [bookingReference, passengerId, flight_id, seat.seat_id, price]
    );
    const booking = bookingIns.rows[0];

    const ticketNumber = await createUniqueTicketNumber(client);
    const ticketIns = await client.query(
      `INSERT INTO tickets(ticket_number, booking_id, passenger_id, flight_id, fare_class, seat_number, total_fare)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING ticket_id, ticket_number, ticket_status, fare_class, seat_number`,
      [ticketNumber, booking.booking_id, passengerId, flight_id, seat.seat_class, seat.seat_number, price]
    );
    const ticket = ticketIns.rows[0];

    const paymentIns = await client.query(
      `INSERT INTO payments(booking_id, amount, payment_method)
       VALUES($1,$2,$3)
       RETURNING payment_id, payment_date, amount, payment_method, payment_status`,
      [booking.booking_id, price, payment_method]
    );
    const payment = paymentIns.rows[0];

    await client.query('COMMIT');

    res.status(201).json({ booking, ticket, payment });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

app.get('/my-tickets', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        t.ticket_id, t.ticket_number, t.ticket_status, t.fare_class, t.seat_number, t.total_fare,
        b.booking_reference, b.booking_status, b.booking_date,
        p.payment_status, p.payment_method, p.amount AS payment_amount, p.payment_date,
        f.flight_number, f.scheduled_departure, f.scheduled_arrival,
        da.city AS departure_city, aa.city AS arrival_city
      FROM passengers ps
      JOIN tickets t ON t.passenger_id = ps.passenger_id
      JOIN bookings b ON b.booking_id = t.booking_id
      LEFT JOIN payments p ON p.booking_id = b.booking_id
      JOIN flights f ON f.flight_id = t.flight_id
      JOIN airports da ON da.airport_id = f.departure_airport_id
      JOIN airports aa ON aa.airport_id = f.arrival_airport_id
      WHERE ps.user_id = $1
      ORDER BY b.booking_date DESC
      `,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/admin/flights', auth, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      flight_number,
      departure_airport_id,
      arrival_airport_id,
      scheduled_departure,
      scheduled_arrival,
      base_price,
      airline_id = 1,
      aircraft_id = 1
    } = req.body || {};

    if (!flight_number || !departure_airport_id || !arrival_airport_id || !scheduled_departure || !scheduled_arrival || !base_price) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }
    if (String(flight_number).trim().length > 10) {
      return res.status(400).json({ error: 'Номер рейса должен быть не длиннее 10 символов' });
    }
    if (Number(departure_airport_id) === Number(arrival_airport_id)) {
      return res.status(400).json({ error: 'Аэропорты вылета и прилета должны отличаться' });
    }

    const dep = new Date(scheduled_departure);
    const arr = new Date(scheduled_arrival);
    if (Number.isNaN(dep.getTime()) || Number.isNaN(arr.getTime()) || dep >= arr) {
      return res.status(400).json({ error: 'Проверьте даты вылета и прилета' });
    }

    await client.query('BEGIN');

    const aircraftRes = await client.query(
      `SELECT total_seats, business_seats, economy_seats
       FROM aircrafts
       WHERE aircraft_id=$1`,
      [Number(aircraft_id)]
    );
    if (aircraftRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Самолет не найден' });
    }
    const aircraft = aircraftRes.rows[0];

    const result = await client.query(
      `INSERT INTO flights (
         flight_number, airline_id, aircraft_id, departure_airport_id, arrival_airport_id,
         scheduled_departure, scheduled_arrival, base_price, status
       )
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'scheduled')
       RETURNING flight_id, flight_number, scheduled_departure, scheduled_arrival, base_price, status`,
      [
        flight_number.trim(),
        Number(airline_id),
        Number(aircraft_id),
        Number(departure_airport_id),
        Number(arrival_airport_id),
        dep.toISOString(),
        arr.toISOString(),
        Number(base_price)
      ]
    );
    const createdFlight = result.rows[0];

    const businessCount = Number(aircraft.business_seats || 0);
    const economyCount = Number(aircraft.economy_seats || 0);
    const totalCount = Number(aircraft.total_seats || 0);
    const generatedTotal = businessCount + economyCount;
    if (totalCount > 0 && generatedTotal !== totalCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Конфигурация мест самолета некорректна (business + economy != total)' });
    }

    const businessRows = buildSeatRows(businessCount, 'business', 1);
    const economyRows = buildSeatRows(economyCount, 'economy', businessRows.nextRow);
    const allGeneratedSeats = [...businessRows.seats, ...economyRows.seats];

    for (const seat of allGeneratedSeats) {
      await client.query(
        `INSERT INTO seats (flight_id, seat_number, seat_class, status)
         VALUES($1,$2,$3,$4)`,
        [createdFlight.flight_id, seat.seat_number, seat.seat_class, seat.status]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      flight: createdFlight,
      seats_generated: allGeneratedSeats.length
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (e.code === '23505') return res.status(409).json({ error: 'Рейс с таким номером уже существует' });
    if (e.code === '23503') return res.status(400).json({ error: 'Некорректные ID авиакомпании, самолета или аэропорта' });
    if (e.code === '22001') return res.status(400).json({ error: 'Одно из значений превышает допустимую длину поля' });
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

app.delete('/admin/flights/:flight_id', auth, requireAdmin, async (req, res) => {
  try {
    const flightId = Number(req.params.flight_id);
    if (!Number.isInteger(flightId) || flightId <= 0) {
      return res.status(400).json({ error: 'Некорректный flight_id' });
    }

    const deleted = await pool.query(
      'DELETE FROM flights WHERE flight_id=$1 RETURNING flight_id, flight_number',
      [flightId]
    );
    if (deleted.rowCount === 0) {
      return res.status(404).json({ error: 'Рейс не найден' });
    }

    res.json({ ok: true, flight: deleted.rows[0] });
  } catch (e) {
    if (e.code === '23503') {
      return res.status(409).json({ error: 'Нельзя удалить рейс: есть связанные бронирования' });
    }
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/admin/tickets', auth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        t.ticket_id, t.ticket_number, t.ticket_status, t.seat_number, t.fare_class, t.total_fare,
        b.booking_id, b.booking_reference, b.booking_status, b.booking_date,
        f.flight_id, f.flight_number, f.scheduled_departure,
        u.email AS user_email,
        p.first_name, p.last_name
      FROM tickets t
      JOIN bookings b ON b.booking_id = t.booking_id
      JOIN flights f ON f.flight_id = t.flight_id
      LEFT JOIN passengers p ON p.passenger_id = t.passenger_id
      LEFT JOIN users u ON u.id = p.user_id
      ORDER BY b.booking_date DESC
      `
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/admin/tickets/:ticket_id', auth, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const ticketId = Number(req.params.ticket_id);
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      return res.status(400).json({ error: 'Некорректный ticket_id' });
    }

    await client.query('BEGIN');
    const ticketRes = await client.query(
      `SELECT t.ticket_id, t.ticket_number, t.booking_id, b.seat_id
       FROM tickets t
       JOIN bookings b ON b.booking_id = t.booking_id
       WHERE t.ticket_id=$1`,
      [ticketId]
    );
    if (ticketRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Билет не найден' });
    }

    const ticket = ticketRes.rows[0];
    await client.query('DELETE FROM bookings WHERE booking_id=$1', [ticket.booking_id]);
    await client.query(`UPDATE seats SET status='available' WHERE seat_id=$1`, [ticket.seat_id]);
    await client.query('COMMIT');

    res.json({
      ok: true,
      ticket: { ticket_id: ticket.ticket_id, ticket_number: ticket.ticket_number },
      booking_id: ticket.booking_id
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

app.get('/admin/reference-data', auth, requireAdmin, async (req, res) => {
  try {
    const [airlinesRes, aircraftsRes, airportsRes] = await Promise.all([
      pool.query(
        `SELECT airline_id, airline_name, country
         FROM airlines
         ORDER BY airline_id`
      ),
      pool.query(
        `SELECT aircraft_id, aircraft_type, registration_number, airline_id
         FROM aircrafts
         ORDER BY aircraft_id`
      ),
      pool.query(
        `SELECT airport_id, airport_name, city, country
         FROM airports
         ORDER BY airport_id`
      )
    ]);

    res.json({
      airlines: airlinesRes.rows,
      aircrafts: aircraftsRes.rows,
      airports: airportsRes.rows
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/admin/airlines', auth, requireAdmin, async (req, res) => {
  try {
    const { airline_name, country, contact_phone = null, email = null, status = 'active' } = req.body || {};
    if (!airline_name || !country) {
      return res.status(400).json({ error: 'airline_name и country обязательны' });
    }
    const result = await pool.query(
      `INSERT INTO airlines(airline_name, country, contact_phone, email, status)
       VALUES($1,$2,$3,$4,$5)
       RETURNING airline_id, airline_name, country, status`,
      [airline_name.trim(), country.trim(), contact_phone, email, status]
    );
    res.status(201).json({ ok: true, airline: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/admin/airlines/:airline_id', auth, requireAdmin, async (req, res) => {
  try {
    const airlineId = Number(req.params.airline_id);
    if (!Number.isInteger(airlineId) || airlineId <= 0) {
      return res.status(400).json({ error: 'Некорректный airline_id' });
    }
    const result = await pool.query(
      'DELETE FROM airlines WHERE airline_id=$1 RETURNING airline_id, airline_name',
      [airlineId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Авиалиния не найдена' });
    res.json({ ok: true, airline: result.rows[0] });
  } catch (e) {
    if (e.code === '23503') {
      return res.status(409).json({ error: 'Нельзя удалить авиалинию: есть связанные самолеты или рейсы' });
    }
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/admin/aircrafts', auth, requireAdmin, async (req, res) => {
  try {
    const {
      aircraft_type,
      registration_number,
      airline_id,
      total_seats,
      business_seats = 0,
      economy_seats,
      status = 'active'
    } = req.body || {};

    if (!aircraft_type || !registration_number || !airline_id || !total_seats) {
      return res.status(400).json({ error: 'aircraft_type, registration_number, airline_id, total_seats обязательны' });
    }

    const total = Number(total_seats);
    const business = Number(business_seats || 0);
    const economy = Number(economy_seats ?? (total - business));
    if (total <= 0 || business < 0 || economy < 0 || business + economy > total) {
      return res.status(400).json({ error: 'Проверьте количество мест' });
    }

    const result = await pool.query(
      `INSERT INTO aircrafts(
         aircraft_type, registration_number, airline_id, total_seats, business_seats, economy_seats, status
       )
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING aircraft_id, aircraft_type, registration_number, airline_id`,
      [aircraft_type.trim(), registration_number.trim(), Number(airline_id), total, business, economy, status]
    );
    res.status(201).json({ ok: true, aircraft: result.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Самолет с таким registration_number уже существует' });
    if (e.code === '23503') return res.status(400).json({ error: 'Некорректный airline_id' });
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/admin/aircrafts/:aircraft_id', auth, requireAdmin, async (req, res) => {
  try {
    const aircraftId = Number(req.params.aircraft_id);
    if (!Number.isInteger(aircraftId) || aircraftId <= 0) {
      return res.status(400).json({ error: 'Некорректный aircraft_id' });
    }
    const result = await pool.query(
      'DELETE FROM aircrafts WHERE aircraft_id=$1 RETURNING aircraft_id, registration_number',
      [aircraftId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Самолет не найден' });
    res.json({ ok: true, aircraft: result.rows[0] });
  } catch (e) {
    if (e.code === '23503') {
      return res.status(409).json({ error: 'Нельзя удалить самолет: есть связанные рейсы' });
    }
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/admin/airports', auth, requireAdmin, async (req, res) => {
  try {
    const { airport_name, city, country } = req.body || {};
    if (!airport_name || !city || !country) {
      return res.status(400).json({ error: 'airport_name, city, country обязательны' });
    }
    const result = await pool.query(
      `INSERT INTO airports(airport_name, city, country)
       VALUES($1,$2,$3)
       RETURNING airport_id, airport_name, city, country`,
      [airport_name.trim(), city.trim(), country.trim()]
    );
    res.status(201).json({ ok: true, airport: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/admin/airports/:airport_id', auth, requireAdmin, async (req, res) => {
  try {
    const airportId = Number(req.params.airport_id);
    if (!Number.isInteger(airportId) || airportId <= 0) {
      return res.status(400).json({ error: 'Некорректный airport_id' });
    }
    const result = await pool.query(
      'DELETE FROM airports WHERE airport_id=$1 RETURNING airport_id, airport_name',
      [airportId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Аэропорт не найден' });
    res.json({ ok: true, airport: result.rows[0] });
  } catch (e) {
    if (e.code === '23503') {
      return res.status(409).json({ error: 'Нельзя удалить аэропорт: есть связанные рейсы' });
    }
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.use(express.static(path.join(__dirname, '../frontend')));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`http://localhost:${port}`));