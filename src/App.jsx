import React, { useEffect, useState } from 'react'
import { db } from './firebase'
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'

function formatCurrency(v) {
  if (v == null || v === '') return ''
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function App() {
  const [transactions, setTransactions] = useState([])
  const [activePerson, setActivePerson] = useState('All')
  const [form, setForm] = useState({ name: '', amount: '', paid: '', date: '', notes: '' })

  useEffect(() => {
    const q = query(collection(db, 'transactions'), orderBy('Date'))
    const unsub = onSnapshot(q, (snap) => {
      const rows = []
      snap.forEach((doc) => rows.push({ id: doc.id, ...doc.data() }))
      setTransactions(rows)
    })
    return () => unsub()
  }, [])

  function getPersonNames() {
    return [...new Set(transactions.map((t) => t.Name).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  }

  function getPersonTotals(personName) {
    const personTxns = transactions.filter((txn) => txn.Name === personName)
    const totalDebt = personTxns.filter((t) => t.Transaction === 'Debt').reduce((s, t) => s + (Number(t.Amount) || 0), 0)
    const totalPayment = personTxns.filter((t) => t.Transaction === 'Payment').reduce((s, t) => s + (Number(t.Amount) || 0), 0)
    return { totalDebt, totalPayment, remaining: Math.max(0, totalDebt - totalPayment) }
  }

  async function addDebt(e) {
    e.preventDefault()
    const name = form.name.trim()
    const amount = Number(form.amount)
    const paid = Number(form.paid || 0)
    if (!name || !amount || isNaN(amount) || amount <= 0) return alert('Enter name and amount')
    if (paid > amount) return alert('Paid cannot exceed amount')

    const date = form.date || new Date().toISOString().split('T')[0]

    // push debt row
    await addDoc(collection(db, 'transactions'), {
      Name: name,
      Transaction: 'Debt',
      Amount: amount,
      BalanceAfter: amount - paid,
      Date: date,
      Notes: form.notes || '',
      createdAt: serverTimestamp(),
    })

    if (paid > 0) {
      await addDoc(collection(db, 'transactions'), {
        Name: name,
        Transaction: 'Payment',
        Amount: paid,
        BalanceAfter: amount - paid,
        Date: date,
        Notes: 'Initial payment',
        createdAt: serverTimestamp(),
      })
    }

    setForm({ name: '', amount: '', paid: '', date: '', notes: '' })
    setActivePerson(name)
  }

  async function recordPayment(personName) {
    const remaining = getPersonTotals(personName).remaining
    const txt = prompt(`Enter payment amount for ${personName} (remaining ${formatCurrency(remaining)}):`, '0.00')
    if (txt === null) return
    const value = Number(txt)
    if (isNaN(value) || value <= 0) return alert('Enter valid amount')
    if (value > remaining) return alert('Cannot exceed remaining')

    const newRemaining = Math.max(0, remaining - value)
    await addDoc(collection(db, 'transactions'), {
      Name: personName,
      Transaction: 'Payment',
      Amount: value,
      BalanceAfter: newRemaining,
      Date: new Date().toISOString().split('T')[0],
      Notes: 'Payment recorded',
      createdAt: serverTimestamp(),
    })
  }

  const names = getPersonNames()

  return (
    <div className="container">
      <header>
        <h1>Debt Tracker (Web)</h1>
        <p>Data stored in Firebase Firestore</p>
      </header>

      <section className="add-row">
        <h2>Add New Debt</h2>
        <form className="form-grid" onSubmit={addDebt}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" />
          <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} type="number" step="0.01" placeholder="Amount" />
          <input value={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.value })} type="number" step="0.01" placeholder="Paid" />
          <input value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} type="date" />
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" />
          <div />
          <button id="addButton" type="submit">Add Debt</button>
        </form>
      </section>

      <section className="tabs">
        <div className="person-tabs">
          <button className={`tab-button ${activePerson === 'All' ? 'active' : ''}`} onClick={() => setActivePerson('All')}>All</button>
          {names.map((n) => (
            <button key={n} className={`tab-button ${activePerson === n ? 'active' : ''}`} onClick={() => setActivePerson(n)}>{n}</button>
          ))}
        </div>
        <div className="summary">
          {activePerson === 'All' ? (
            <span>All people: Total {formatCurrency(transactions.reduce((s, t) => s + (t.Transaction === 'Debt' ? Number(t.Amount) : 0), 0))}</span>
          ) : (
            <span>{activePerson}: Remaining {formatCurrency(getPersonTotals(activePerson).remaining)}</span>
          )}
        </div>
      </section>

      <section className="table-wrapper">
        <h2>Debts</h2>
        <table>
          <thead>
            <tr>
              <th>Name / Transaction</th>
              <th>Amount</th>
              <th>Paid</th>
              <th>Remaining</th>
              <th>Date</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {activePerson === 'All' ? (
              names.length === 0 ? (
                <tr><td colSpan={7}>No records yet.</td></tr>
              ) : (
                names.map((name) => {
                  const totals = getPersonTotals(name)
                  return (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{formatCurrency(totals.totalDebt)}</td>
                      <td>{formatCurrency(totals.totalPayment)}</td>
                      <td>{formatCurrency(totals.remaining)}</td>
                      <td></td>
                      <td></td>
                      <td><button className="action-button pay-button" onClick={() => recordPayment(name)}>Pay</button></td>
                    </tr>
                  )
                })
              )
            ) : (
              transactions.filter((t) => t.Name === activePerson).map((txn) => (
                <tr key={txn.id}>
                  <td>{txn.Transaction}</td>
                  <td>{formatCurrency(txn.Amount)}</td>
                  <td>{txn.Transaction === 'Payment' ? formatCurrency(txn.Amount) : ''}</td>
                  <td>{formatCurrency(txn.BalanceAfter)}</td>
                  <td>{txn.Date}</td>
                  <td>{txn.Notes}</td>
                  <td></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
