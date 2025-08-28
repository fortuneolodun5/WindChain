;; RevenueDistributor.clar
;; Core contract for distributing revenues from wind farm energy outputs to share holders.
;; Integrates with OutputTracker for outputs, ShareToken for ownership, and WindFarmRegistry for validation.
;; Supports periodic distributions, claimable payouts, and governance overrides.
;; Uses STX as revenue token for simplicity; can be extended to other FTs.

;; Traits for dependencies
(define-trait output-tracker-trait
  (
    (get-period-output (uint uint) (response uint uint))  ;; farm-id, period -> output in kWh
    (get-last-period (uint) (response uint uint))         ;; farm-id -> last completed period
  )
)

(define-trait share-token-trait
  (
    (get-balance (principal) (response uint uint))        ;; balance of principal
    (get-total-supply () (response uint uint))            ;; total shares
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))  ;; SIP-010 transfer
  )
)

(define-trait wind-farm-registry-trait
  (
    (get-farm-owner (uint) (response principal uint))    ;; farm-id -> owner
    (is-farm-active (uint) (response bool uint))         ;; check if active
  )
)

;; Constants
(define-constant ERR-UNAUTHORIZED (err u100))
(define-constant ERR-INVALID-FARM (err u101))
(define-constant ERR-NO-OUTPUT (err u102))
(define-constant ERR-INVALID-AMOUNT (err u103))
(define-constant ERR-DISTRIBUTION-ACTIVE (err u104))
(define-constant ERR-NO-PENDING (err u105))
(define-constant ERR-PAUSED (err u106))
(define-constant ERR-INVALID-PERIOD (err u107))
(define-constant ERR-ALREADY-CLAIMED (err u108))
(define-constant ERR-INVALID-RATE (err u109))
(define-constant ERR-TRANSFER-FAILED (err u110))
(define-constant ERR-INSUFFICIENT-BALANCE (err u111))
(define-constant ERR-INVALID-OWNER (err u112))
(define-constant ERR-MATH-OVERFLOW (err u113))

(define-constant PERIOD-DURATION u144)  ;; ~1 day in blocks, adjustable
(define-constant MAX-RATE u1000000)     ;; max STX per kWh, scaled
(define-constant SCALE-FACTOR u1000000) ;; for precision in calculations

;; Data Variables
(define-data-var contract-owner principal tx-sender)
(define-data-var is-paused bool false)
(define-data-var default-rate uint u100)  ;; default STX per kWh, adjustable
(define-data-var treasury-fee uint u5)     ;; 0.5% fee, scaled by 1000

;; Data Maps
(define-map farm-rates uint uint)  ;; farm-id -> custom rate (STX/kWh)
(define-map distributions 
  { farm-id: uint, period: uint } 
  {
    total-revenue: uint,
    total-shares: uint,
    per-share: uint,
    distributed-at: uint,
    claimed: uint
  }
)

(define-map user-claims 
  { farm-id: uint, period: uint, user: principal } 
  {
    claimed-amount: uint,
    claimed-at: uint
  }
)

(define-map pending-deposits uint uint)  ;; farm-id -> pending STX before distribution

;; Private Functions
(define-private (calculate-revenue (farm-id uint) (period uint) (output uint))
  (let 
    (
      (rate (default (map-get? farm-rates farm-id) (var-get default-rate)))
      (revenue (/ (* output rate) SCALE-FACTOR))
    )
    (if (> revenue u0)
      (ok revenue)
      ERR-NO-OUTPUT
    )
  )
)

(define-private (compute-per-share (total-revenue uint) (total-shares uint))
  (if (> total-shares u0)
    (/ (* total-revenue SCALE-FACTOR) total-shares)
    u0
  )
)

(define-private (apply-fee (amount uint))
  (/ (* amount (- u1000 (var-get treasury-fee))) u1000)
)

(define-private (transfer-stx (amount uint) (recipient principal))
  (match (stx-transfer? amount tx-sender recipient)
    success (ok true)
    error ERR-TRANSFER-FAILED
  )
)

(define-private (safe-add (a uint) (b uint))
  (let ((sum (+ a b)))
    (if (>= sum a)  ;; overflow check
      sum
      (unwrap-panic ERR-MATH-OVERFLOW)
    )
  )
)

(define-private (safe-mul (a uint) (b uint))
  (let ((prod (* a b)))
    (if (or (is-eq a u0) (is-eq (/ prod a) b))
      prod
      (unwrap-panic ERR-MATH-OVERFLOW)
    )
  )
)

;; Public Functions

(define-public (set-rate (farm-id uint) (new-rate uint))
  (let 
    (
      (owner (unwrap! (contract-call? .wind-farm-registry get-farm-owner farm-id) ERR-INVALID-FARM))
    )
    (if (is-eq tx-sender owner)
      (begin
        (asserts! (and (> new-rate u0) (<= new-rate MAX-RATE)) ERR-INVALID-RATE)
        (map-set farm-rates farm-id new-rate)
        (ok true)
      )
      ERR-UNAUTHORIZED
    )
  )
)

(define-public (deposit-revenue (farm-id uint) (amount uint))
  (let 
    (
      (owner (unwrap! (contract-call? .wind-farm-registry get-farm-owner farm-id) ERR-INVALID-FARM))
      (current-pending (default-to u0 (map-get? pending-deposits farm-id)))
    )
    (asserts! (not (var-get is-paused)) ERR-PAUSED)
    (asserts! (is-eq tx-sender owner) ERR-UNAUTHORIZED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (map-set pending-deposits farm-id (safe-add current-pending amount))
    (ok true)
  )
)

(define-public (initiate-distribution (farm-id uint) (period uint))
  (let 
    (
      (owner (unwrap! (contract-call? .wind-farm-registry get-farm-owner farm-id) ERR-INVALID-FARM))
      (output (unwrap! (contract-call? .output-tracker get-period-output farm-id period) ERR-NO-OUTPUT))
      (calculated-revenue (unwrap! (calculate-revenue farm-id period output) ERR-NO-OUTPUT))
      (deposited (default-to u0 (map-get? pending-deposits farm-id)))
      (total-revenue (min calculated-revenue deposited))
      (total-shares (unwrap! (as-contract (contract-call? .share-token get-total-supply)) ERR-INVALID-AMOUNT))
      (per-share (compute-per-share (apply-fee total-revenue) total-shares))
    )
    (asserts! (not (var-get is-paused)) ERR-PAUSED)
    (asserts! (is-eq tx-sender owner) ERR-UNAUTHORIZED)
    (asserts! (is-none (map-get? distributions {farm-id: farm-id, period: period})) ERR-DISTRIBUTION-ACTIVE)
    (asserts! (> total-revenue u0) ERR-INVALID-AMOUNT)
    (asserts! (> total-shares u0) ERR-INVALID-AMOUNT)
    (map-set distributions 
      {farm-id: farm-id, period: period}
      {
        total-revenue: total-revenue,
        total-shares: total-shares,
        per-share: per-share,
        distributed-at: block-height,
        claimed: u0
      }
    )
    (map-delete pending-deposits farm-id)  ;; clear pending after use
    (print {event: "distribution-initiated", farm-id: farm-id, period: period, revenue: total-revenue})
    (ok true)
  )
)

(define-public (claim-distribution (farm-id uint) (period uint))
  (let 
    (
      (dist (unwrap! (map-get? distributions {farm-id: farm-id, period: period}) ERR-INVALID-PERIOD))
      (user-share (unwrap! (as-contract (contract-call? .share-token get-balance tx-sender)) ERR-INVALID-AMOUNT))
      (claim-record (map-get? user-claims {farm-id: farm-id, period: period, user: tx-sender}))
      (pending-amount (/ (safe-mul (get per-share dist) user-share) SCALE-FACTOR))
    )
    (asserts! (not (var-get is-paused)) ERR-PAUSED)
    (asserts! (> pending-amount u0) ERR-NO-PENDING)
    (asserts! (is-none claim-record) ERR-ALREADY-CLAIMED)
    (try! (as-contract (transfer-stx pending-amount tx-sender)))
    (map-set distributions 
      {farm-id: farm-id, period: period}
      (merge dist {claimed: (safe-add (get claimed dist) pending-amount)})
    )
    (map-set user-claims 
      {farm-id: farm-id, period: period, user: tx-sender}
      {
        claimed-amount: pending-amount,
        claimed-at: block-height
      }
    )
    (print {event: "claim", farm-id: farm-id, period: period, user: tx-sender, amount: pending-amount})
    (ok pending-amount)
  )
)

(define-public (pause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set is-paused true)
    (ok true)
  )
)

(define-public (unpause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set is-paused false)
    (ok true)
  )
)

(define-public (set-treasury-fee (new-fee uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (asserts! (< new-fee u100) ERR-INVALID_AMOUNT)  ;; max 10%
    (var-set treasury-fee new-fee)
    (ok true)
  )
)

(define-public (set-default-rate (new-rate uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (asserts! (and (> new-rate u0) (<= new-rate MAX-RATE)) ERR-INVALID-RATE)
    (var-set default-rate new-rate)
    (ok true)
  )
)

(define-public (withdraw-treasury (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (as-contract (try! (transfer-stx amount recipient)))
    (ok true)
  )
)

;; Read-Only Functions

(define-read-only (get-distribution-details (farm-id uint) (period uint))
  (map-get? distributions {farm-id: farm-id, period: period})
)

(define-read-only (get-pending-claim (farm-id uint) (period uint) (user principal))
  (let 
    (
      (dist (map-get? distributions {farm-id: farm-id, period: period}))
      (user-share (unwrap-panic (as-contract (contract-call? .share-token get-balance user))))
    )
    (match dist
      some-dist (/ (* (get per-share some-dist) user-share) SCALE-FACTOR)
      none u0
    )
  )
)

(define-read-only (get-farm-rate (farm-id uint))
  (default-to (var-get default-rate) (map-get? farm-rates farm-id))
)

(define-read-only (get-contract-balance)
  (as-contract (stx-get-balance tx-sender))
)

(define-read-only (get-paused)
  (var-get is-paused)
)

(define-read-only (get-treasury-fee)
  (var-get treasury-fee)
)

(define-read-only (get-default-rate)
  (var-get default-rate)
)

(define-read-only (get-pending-deposit (farm-id uint))
  (default-to u0 (map-get? pending-deposits farm-id))
)

(define-read-only (get-user-claim (farm-id uint) (period uint) (user principal))
  (map-get? user-claims {farm-id: farm-id, period: period, user: user})
)