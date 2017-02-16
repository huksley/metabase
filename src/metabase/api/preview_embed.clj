(ns metabase.api.preview-embed
  "Endpoints for previewing how Cards and Dashboards will look when embedding them.
   These endpoints are basically identical in functionality to the ones in `/api/embed`, but:

   1.  Require admin access
   2.  Ignore the values of `:enabled_embedding` for Cards/Dashboards
   3.  Ignore the `:embed_params` whitelist for Card/Dashboards, instead using a field called `:_embedding_params` in the JWT token itself.

   Refer to the documentation for those endpoints for further details."
  (:require [compojure.core :refer [GET]]
            (metabase.api [common :as api]
                          [embed :as embed-api]
                          [public :as public-api])
            [metabase.util.embed :as eu]))

(defn- check-and-unsign [token]
  (api/check-superuser)
  (api/check-embedding-enabled)
  (eu/unsign token))

(api/defendpoint GET "/card/:token"
  "Fetch a Card you're considering embedding by passing a JWT TOKEN."
  [token]
  (let [unsigned-token (check-and-unsign token)
        card-id        (eu/get-in-unsigned-token-or-throw unsigned-token [:resource :question])
        token-params   (eu/get-in-unsigned-token-or-throw unsigned-token [:params])]
    ;; TODO - enforce params whitelist, passed as :_embedding_params
    (-> (public-api/public-card :id card-id)
        embed-api/add-implicit-card-parameters
        (embed-api/remove-token-parameters token-params))))

(api/defendpoint GET "/card/:token/query"
  "Fetch the query results for a Card you're considering embedding by passing a JWT TOKEN."
  [token & query-params]
  (let [unsigned-token   (check-and-unsign token)
        card-id          (eu/get-in-unsigned-token-or-throw unsigned-token [:resource :question])
        token-params     (eu/get-in-unsigned-token-or-throw unsigned-token [:params])
        embedding-params (eu/get-in-unsigned-token-or-throw unsigned-token [:_embedding_params])
        parameter-values (embed-api/validate-params embedding-params token-params query-params)
        parameters       (embed-api/apply-parameter-values (embed-api/resolve-card-parameters card-id) parameter-values)]
    (public-api/run-query-for-card-with-id card-id parameters)))

(api/defendpoint GET "/dashboard/:token"
  "Fetch a Dashboard you're considering embedding by passing a JWT TOKEN. "
  [token]
  (let [unsigned     (check-and-unsign token)
        id           (eu/get-in-unsigned-token-or-throw unsigned [:resource :dashboard])
        token-params (eu/get-in-unsigned-token-or-throw unsigned [:params])]
    ;; TODO - enforce params whitelist, passed as :_embedding_params
    (-> (public-api/public-dashboard :id id)
        (embed-api/remove-token-parameters token-params))))

(api/defendpoint GET "/dashboard/:token/dashcard/:dashcard-id/card/:card-id"
  "Fetch the results of running a Card belonging to a Dashboard you're considering embedding with JWT TOKEN."
  [token dashcard-id card-id & query-params]
  (let [unsigned-token   (check-and-unsign token)
        dashboard-id     (eu/get-in-unsigned-token-or-throw unsigned-token [:resource :dashboard])
        token-params     (eu/get-in-unsigned-token-or-throw unsigned-token [:params])
        embedding-params (eu/get-in-unsigned-token-or-throw unsigned-token [:_embedding_params])
        parameter-values (embed-api/validate-params embedding-params token-params query-params)
        parameters       (embed-api/apply-parameter-values (embed-api/resolve-dashboard-parameters dashboard-id dashcard-id card-id) parameter-values)]
    (public-api/public-dashcard-results dashboard-id card-id parameters)))


(api/define-routes)
