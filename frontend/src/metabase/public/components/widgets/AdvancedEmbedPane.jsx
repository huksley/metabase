/* @flow */

import React, { Component, PropTypes } from "react";

import ToggleLarge from "metabase/components/ToggleLarge";
import ActionButton from "metabase/components/ActionButton";

import Parameters from "metabase/dashboard/containers/Parameters";

import AdvancedSettingsPane from "./AdvancedSettingsPane";
import PreviewPane from "./PreviewPane";
import EmbedCodePane from "./EmbedCodePane";

import type { Parameter, ParameterId } from "metabase/meta/types/Dashboard";
import type { Pane, EmbedType, EmbeddableResource, EmbeddingParams, DisplayOptions } from "./EmbedModalContent";

import _ from "underscore";

type Props = {
    pane: Pane,
    embedType: EmbedType,

    resourceType: string,
    resource: EmbeddableResource,
    resourceParameters:  Parameter[],

    token: string,
    iframeUrl: string,
    siteUrl: string,
    secretKey: string,
    params: { [slug: string]: any },

    displayOptions: DisplayOptions,
    previewParameters: Parameter[],
    parameterValues: { [id: ParameterId]: any },
    embeddingParams: EmbeddingParams,

    onChangeDisplayOptions: (DisplayOptions) => void,
    onChangeEmbeddingParameters: (EmbeddingParams) => void,
    onChangeParameterValue: (id: ParameterId, value: any) => void,
    onChangePane: (pane: Pane) => void,
    onSave: () => Promise<void>
};

const AdvancedEmbedPane = ({
    pane,
    resource,
    resourceType,
    embedType,
    token,
    iframeUrl,
    siteUrl,
    secretKey,
    params,
    displayOptions,
    previewParameters,
    parameterValues,
    resourceParameters,
    embeddingParams,
    onChangeDisplayOptions,
    onChangeEmbeddingParameters,
    onChangeParameterValue,
    onChangePane,
    onSave
}: Props) =>
    <div className="full flex flex-column">
        { !resource.enable_embedding || !_.isEqual(resource.embedding_params, embeddingParams) ?
            <div className="mb2 p2 bordered rounded flex align-center">
                <div>
                    { resource.enable_embedding ?
                        `You’ve made changes that need to be published before they will be reflected in your application embed.` :
                        `You will need to publish this ${resourceType} before you can embed it in another application.`
                    }
                </div>
                <ActionButton success medium className="ml-auto" actionFn={onSave} activeText="Updating..." successText="Updated" failedText="Failed!">Publish</ActionButton>
            </div>
        : null }
        <ToggleLarge
            className="mb2"
            style={{ width: 244, height: 34 }}
            value={pane === "preview"}
            textLeft="Preview"
            textRight="Code"
            onChange={() => onChangePane(pane === "preview" ? "code" : "preview")}
        />
        <div className={"flex-full flex"}>
            <div className="flex-full flex flex-column">
                { embedType === "application" && previewParameters.length > 0 &&
                    <div className="mb2 bordered rounded bg-white p2">
                        <h3 className="mb2">Preview Locked Parameters</h3>
                        <Parameters
                            parameters={previewParameters}
                            parameterValues={parameterValues}
                            setParameterValue={onChangeParameterValue}
                        />
                    </div>
                }
                { pane === "preview" ?
                    <PreviewPane
                        className="flex-full"
                        previewUrl={iframeUrl}
                    />
                : pane === "code" ?
                    <EmbedCodePane
                        className="flex-full"
                        embedType={embedType}
                        resource={resource}
                        resourceType={resourceType}
                        iframeUrl={iframeUrl}
                        token={token}
                        siteUrl={siteUrl}
                        secretKey={secretKey}
                        params={params}
                        displayOptions={displayOptions}
                    />
                : null }
            </div>
            <div className="ml4">
                <AdvancedSettingsPane
                    pane={pane}
                    embedType={embedType}
                    onChangePane={onChangePane}
                    resourceType={resourceType}
                    resourceParameters={resourceParameters}
                    embeddingParams={embeddingParams}
                    onChangeEmbeddingParameters={onChangeEmbeddingParameters}
                    displayOptions={displayOptions}
                    onChangeDisplayOptions={onChangeDisplayOptions}
                    onSave={onSave}
                />
            </div>
        </div>
    </div>;

export default AdvancedEmbedPane;
