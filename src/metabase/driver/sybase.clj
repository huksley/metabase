(ns metabase.driver.sybase
  (:require [clojure.string :as s]
            [honeysql.core :as hsql]
            [metabase.db.spec :as dbspec]
            [metabase.driver :as driver]
            [metabase.driver.generic-sql :as sql]
            [metabase.util :as u]
            [metabase.util.honeysql-extensions :as hx])
  (:import net.sourceforge.jtds.jdbc.Driver)) ; need to import this in order to load JDBC driver

(defn- column->base-type
  "See [this page](https://msdn.microsoft.com/en-us/library/ms187752.aspx) for details."
  [column-type]
  ({:bigint           :type/BigInteger
    :binary           :type/*
    :bit              :type/Boolean ; actually this is 1 / 0 instead of true / false ...
    :char             :type/Text
    :cursor           :type/*
    :date             :type/Date
    :datetime         :type/DateTime
    :datetime2        :type/DateTime
    :datetimeoffset   :type/DateTime
    :decimal          :type/Decimal
    :float            :type/Float
    :geography        :type/*
    :geometry         :type/*
    :hierarchyid      :type/*
    :image            :type/*
    :int              :type/Integer
    :money            :type/Decimal
    :nchar            :type/Text
    :ntext            :type/Text
    :numeric          :type/Decimal
    :nvarchar         :type/Text
    :real             :type/Float
    :smalldatetime    :type/DateTime
    :smallint         :type/Integer
    :smallmoney       :type/Decimal
    :sql_variant      :type/*
    :table            :type/*
    :text             :type/Text
    :time             :type/Time
    :timestamp        :type/* ; not a standard SQL timestamp, see https://msdn.microsoft.com/en-us/library/ms182776.aspx
    :tinyint          :type/Integer
    :uniqueidentifier :type/UUID
    :varbinary        :type/*
    :varchar          :type/Text
    :xml              :type/*
    (keyword "int identity") :type/Integer} column-type)) ; auto-incrementing integer (ie pk) field

(defn- connection-details->spec [{:keys [domain instance ssl params], :as details}]
  (-> ;; Having the `:ssl` key present, even if it is `false`, will make the driver attempt to connect with SSL
      (dbspec/sybase (if ssl
                      details
                      (dissoc details :ssl)))
      (assoc :classname   "net.sourceforge.jtds.jdbc.Driver"
             :subprotocol "jtds:sybase")

      ;; adjust the connection URL to match up with the jTDS format (see http://jtds.sourceforge.net/faq.html#urlFormat)
      (update :subname (fn [subname]
                         ;; jTDS uses a "/" instead of ";database="
                         (cond-> (s/replace subname #";database=" "/")
                           ;; and add the ;instance= option if applicable
                           (seq instance) (str ";instance=" instance)

                           ;; add Windows domain for Windows domain authentication if applicable. useNTLMv2 = send LMv2/NTLMv2 responses when using Windows auth
                           (seq domain) (str ";domain=" domain ";useNTLMv2=true")
                                 
                           ;; One can specify additional params
                           (seq params) (str ";" + params)

                           ;; If SSL is specified append ;ssl=require, which enables SSL and throws exception if SSL connection cannot be made
                           ssl (str ";ssl=require"))))))

(defn- date-part [unit expr]
  (hsql/call :datepart (hsql/raw (name unit)) expr))

(defn- date-add [unit & exprs]
  (apply hsql/call :dateadd (hsql/raw (name unit)) exprs))

(defn- date
  "See also the [jTDS SQL <-> Java types table](http://jtds.sourceforge.net/typemap.html)"
  [unit expr]
  (case unit
    :default         expr
    :minute          (hx/cast :smalldatetime expr)
    :minute-of-hour  (date-part :minute expr)
    :hour            (hx/->datetime (hx/format "yyyy-MM-dd HH:00:00" expr))
    :hour-of-day     (date-part :hour expr)
    ;; jTDS is retarded; I sense an ongoing theme here. It returns DATEs as strings instead of as java.sql.Dates
    ;; like every other SQL DB we support. Work around that by casting to DATE for truncation then back to DATETIME so we get the type we want
    :day             (hx/->datetime (hx/->date expr))
    :day-of-week     (date-part :weekday expr)
    :day-of-month    (date-part :day expr)
    :day-of-year     (date-part :dayofyear expr)
    ;; Subtract the number of days needed to bring us to the first day of the week, then convert to date
    ;; The equivalent SQL looks like:
    ;;     CAST(DATEADD(day, 1 - DATEPART(weekday, %s), CAST(%s AS DATE)) AS DATETIME)
    :week            (hx/->datetime
                      (date-add :day
                                (hx/- 1 (date-part :weekday expr))
                                (hx/->date expr)))
    :week-of-year    (date-part :iso_week expr)
    :month           (hx/->datetime (hx/format "yyyy-MM-01" expr))
    :month-of-year   (date-part :month expr)
    ;; Format date as yyyy-01-01 then add the appropriate number of quarter
    ;; Equivalent SQL:
    ;;     DATEADD(quarter, DATEPART(quarter, %s) - 1, FORMAT(%s, 'yyyy-01-01'))
    :quarter         (date-add :quarter
                               (hx/dec (date-part :quarter expr))
                               (hx/format "yyyy-01-01" expr))
    :quarter-of-year (date-part :quarter expr)
    :year            (date-part :year expr)))

(defn- date-interval [unit amount]
  (date-add unit amount :%getutcdate))

(defn- unix-timestamp->timestamp [expr seconds-or-milliseconds]
  (case seconds-or-milliseconds
    ;; The second argument to DATEADD() gets casted to a 32-bit integer. BIGINT is 64 bites, so we tend to run into
    ;; integer overflow errors (especially for millisecond timestamps).
    ;; Work around this by converting the timestamps to minutes instead before calling DATEADD().
    :seconds      (date-add :minute (hx// expr 60) (hx/literal "1970-01-01"))
    :milliseconds (recur (hx// expr 1000) :seconds)))

(defn- apply-limit [honeysql-form {value :limit}]
  (assoc honeysql-form :modifiers [(format "TOP %d" value)]))

;; Sybase doesn't support `TRUE`/`FALSE`; it uses `1`/`0`, respectively; convert these booleans to numbers.
(defn- prepare-value [{value :value}]
  (cond
    (true? value)  1
    (false? value) 0
    :else          value))

(defn- string-length-fn [field-key]
  (hsql/call :len (hx/cast :VARCHAR field-key)))


(defrecord SybaseDriver []
  clojure.lang.Named
  (getName [_] "Sybase"))

(u/strict-extend SybaseDriver
  driver/IDriver
  (merge (sql/IDriverSQLDefaultsMixin)
         {:date-interval  (u/drop-first-arg date-interval)
          :details-fields (constantly [{:name         "host"
                                        :display-name "Host"
                                        :default      "localhost"}
                                       {:name         "port"
                                        :display-name "Port"
                                        :type         :integer
                                        :default      5000}
                                       {:name         "db"
                                        :display-name "Database name"
                                        :placeholder  "BirdsOfTheWorld"
                                        :required     true}
                                       {:name         "user"
                                        :display-name "Database username"
                                        :placeholder  "What username do you use to login to the database?"
                                        :required     true}
                                       {:name         "password"
                                        :display-name "Database password"
                                        :type         :password
                                        :placeholder  "*******"}
                                       {:name         "ssl"
                                        :display-name "Use a secure connection (SSL)?"
                                        :type         :boolean
                                        :default      false}
                                        {:name         "params"
                                        :display-name "Additional params for driver"
                                        :default      ""}
                                       ])})

  sql/ISQLDriver
  (merge (sql/ISQLDriverDefaultsMixin)
         {:apply-limit               (u/drop-first-arg apply-limit)
          :column->base-type         (u/drop-first-arg column->base-type)
          :connection-details->spec  (u/drop-first-arg connection-details->spec)
          :current-datetime-fn       (constantly :%getutcdate)
          :date                      (u/drop-first-arg date)
          :excluded-schemas          (constantly #{"sys" "INFORMATION_SCHEMA" "sybsystemdb" "sybsystemprocs"})
          :field-percent-urls        sql/slow-field-percent-urls
          :prepare-value             (u/drop-first-arg prepare-value)
          :stddev-fn                 (constantly :stdev)
          :string-length-fn          (u/drop-first-arg string-length-fn)
          :unix-timestamp->timestamp (u/drop-first-arg unix-timestamp->timestamp)}))

(driver/register-driver! :sybase (SybaseDriver.))
