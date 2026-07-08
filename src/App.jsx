import React, { useEffect, useState } from 'react'
import { db, auth, hasFirebaseConfig, missingConfigKeys } from './firebase'
import {
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'

const STORAGE_KEY = 'debt-tracker-transactions-v1'

function formatCurrency(v) {
  if (v == null || v === '') return ''
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function getStorageKey(uid = '') {
  return uid ? `${STORAGE_KEY}-${uid}` : STORAGE_KEY
}

function readStoredTransactions(uid = '') {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(getStorageKey(uid))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveStoredTransactions(rows, uid = '') {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(getStorageKey(uid), JSON.stringify(rows))
}

export default function App() {
  const [transactions, setTransactions] = useState([])
  const [activePerson, setActivePerson] = useState('All')
  const [form, setForm] = useState({ name: '', amount: '', paid: '', date: '', notes: '' })
  const [statusMessage, setStatusMessage] = useState('')
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [authMode, setAuthMode] = useState('sign-in')
  const [user, setUser] = useState(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    if (!hasFirebaseConfig || !auth || !db) {
      setTransactions(readStoredTransactions())
      const missingText = missingConfigKeys.length > 0 ? `Missing values: ${missingConfigKeys.join(', ')}` : 'The Firebase config is invalid.'
      setStatusMessage(`Firebase is not configured yet. Add these values in Netlify or your local .env.local file: ${missingText}`)
      return undefined
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      if (currentUser) {
        setStatusMessage('Signed in. Your debts are now linked to your account.')
        setTransactions(readStoredTransactions(currentUser.uid))
      } else {
        setTransactions([])
        setStatusMessage('Please sign in to save debts securely.')
      }
    })

    return () => unsubscribeAuth()
  }, [])

  useEffect(() => {
    if (!hasFirebaseConfig || !auth || !db || !user) return undefined

    const q = query(collection(db, 'transactions'), where('userId', '==', user.uid))
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const rows = []
        snap.forEach((doc) => rows.push({ id: doc.id, ...doc.data() }))
        rows.sort((a, b) => (Number(a.createdAt?.seconds || 0) - Number(b.createdAt?.seconds || 0)))
        setTransactions(rows)
        saveStoredTransactions(rows, user.uid)
      },
      (error) => {
        console.error('Firestore listener error', error)
        setTransactions(readStoredTransactions(user.uid))
        setStatusMessage('Unable to sync with Firestore. Check your rules and Firebase connection.')
      },
    )

    return () => unsubscribe()
  }, [user?.uid])

  function getPersonNames() {
    return [...new Set(transactions.map((t) => t.Name).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  }

  function getPersonTotals(personName) {
    const personTxns = transactions.filter((txn) => txn.Name === personName)
    const totalDebt = personTxns.filter((t) => t.Transaction === 'Debt').reduce((s, t) => s + (Number(t.Amount) || 0), 0)
    const totalPayment = personTxns.filter((t) => t.Transaction === 'Payment').reduce((s, t) => s + (Number(t.Amount) || 0), 0)
    return { totalDebt, totalPayment, remaining: Math.max(0, totalDebt - totalPayment) }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault()
    if (!hasFirebaseConfig || !auth) {
      setAuthError('Firebase is not configured yet. Add the environment variables first.')
      return
    }

    setAuthBusy(true)
    setAuthError('')

    try {
      if (authMode === 'sign-in') {
        await signInWithEmailAndPassword(auth, authForm.email, authForm.password)
      } else {
        await createUserWithEmailAndPassword(auth, authForm.email, authForm.password)
      }
      setAuthForm({ email: '', password: '' })
    } catch (error) {
      console.error('Authentication error', error)
      setAuthError(error.message || 'Authentication failed')
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleSignOut() {
    try {
      await signOut(auth)
      setTransactions([])
      setStatusMessage('You have signed out.')
    } catch (error) {
      console.error('Sign out error', error)
    }
  }

  async function addDebt(e) {
    e.preventDefault()
    if (!user) {
      setStatusMessage('Please sign in before adding debt.')
      return
    }

    const name = form.name.trim()
    const amount = Number(form.amount)
    const paid = Number(form.paid || 0)
    if (!name || !amount || isNaN(amount) || amount <= 0) return alert('Enter name and amount')
    if (paid > amount) return alert('Paid cannot exceed amount')

    const date = form.date || new Date().toISOString().split('T')[0]
    const debtRecord = {
      Name: name,
      Transaction: 'Debt',
      Amount: amount,
      BalanceAfter: amount - paid,
      Date: date,
      Notes: form.notes || '',
      userId: user.uid,
      createdAt: serverTimestamp(),
    }

    const paymentRecord = {
      Name: name,
      Transaction: 'Payment',
      Amount: paid,
      BalanceAfter: amount - paid,
      Date: date,
      Notes: 'Initial payment',
      userId: user.uid,
      createdAt: serverTimestamp(),
    }

    const optimisticRows = [...transactions, { ...debtRecord, id: `local-${Date.now()}` }]
    if (paid > 0) optimisticRows.push({ ...paymentRecord, id: `local-${Date.now() + 1}` })
    setTransactions(optimisticRows)
    saveStoredTransactions(optimisticRows, user.uid)

    if (!hasFirebaseConfig || !db) {
      setStatusMessage('Firebase is not configured. Add your environment variables before deploying.')
      return
    }

    try {
      await addDoc(collection(db, 'transactions'), debtRecord)
      if (paid > 0) {
        await addDoc(collection(db, 'transactions'), paymentRecord)
      }
      setStatusMessage('Debt saved securely to Firestore for your account.')
    } catch (error) {
      console.error('Firestore write error', error)
      setStatusMessage('The debt could not be saved to Firestore. Check your Firestore rules and authentication setup.')
    }

    setForm({ name: '', amount: '', paid: '', date: '', notes: '' })
    setActivePerson(name)
  }

  async function recordPayment(personName) {
    if (!user) {
      setStatusMessage('Please sign in before recording a payment.')
      return
    }

    const remaining = getPersonTotals(personName).remaining
    const txt = prompt(`Enter payment amount for ${personName} (remaining ${formatCurrency(remaining)}):`, '0.00')
    if (txt === null) return
    const value = Number(txt)
    if (isNaN(value) || value <= 0) return alert('Enter valid amount')
    if (value > remaining) return alert('Cannot exceed remaining')

    const newRemaining = Math.max(0, remaining - value)
    const paymentRecord = {
      Name: personName,
      Transaction: 'Payment',
      Amount: value,
      BalanceAfter: newRemaining,
      Date: new Date().toISOString().split('T')[0],
      Notes: 'Payment recorded',
      userId: user.uid,
      createdAt: serverTimestamp(),
    }

    const optimisticRows = [...transactions, { ...paymentRecord, id: `local-${Date.now()}` }]
    setTransactions(optimisticRows)
    saveStoredTransactions(optimisticRows, user.uid)

    if (!hasFirebaseConfig || !db) {
      setStatusMessage('Firebase is not configured. Add your environment variables before deploying.')
      return
    }

    try {
      await addDoc(collection(db, 'transactions'), paymentRecord)
      setStatusMessage('Payment saved securely to Firestore for your account.')
    } catch (error) {
      console.error('Firestore write error', error)
      setStatusMessage('The payment could not be saved to Firestore. Check your Firestore rules and authentication setup.')
    }
  }

  const names = getPersonNames()

  return (
    <div className="container">
      <header>
        <h1>Debt Tracker (Web)</h1>
        <p>Securely stored in Firebase Firestore for the signed-in user</p>
      </header>

      <section className="auth-card">
        <h2>Account</h2>
        {user ? (
          <div className="auth-signed-in">
            <p>Signed in as {user.email || 'your account'}</p>
            <button onClick={handleSignOut}>Sign out</button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <input
              value={authForm.email}
              onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
              type="email"
              placeholder="Email"
              required
            />
            <input
              value={authForm.password}
              onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
              type="password"
              placeholder="Password"
              required
              minLength="6"
            />
            <div className="auth-actions">
              <button type="submit" disabled={authBusy}>{authBusy ? 'Working...' : 'Sign in'}</button>
              <button type="button" className="secondary-button" onClick={() => setAuthMode(authMode === 'sign-in' ? 'sign-up' : 'sign-in')}>
                {authMode === 'sign-in' ? 'Create account' : 'Use existing account'}
              </button>
            </div>
            {authError ? <p className="auth-error">{authError}</p> : null}
          </form>
        )}
      </section>

      <section className="add-row">
        <h2>Add New Debt</h2>
        {statusMessage ? <p className="status">{statusMessage}</p> : null}
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
