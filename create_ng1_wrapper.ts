/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ComponentFactoryResolver, Injector, Type} from '@angular/core';
import {NgElementConfig} from '@angular/elements';

/**
 * Available values for locals use in AngularJS output expressions.
 *
 * AngularJS normally allows any name for different locals values, but Angular
 * only emits a single value at a time, which will be specifically called
 * "detail".
 *
 * $event: The CustomEvent fired. See CustomEvent for type information.
 *     https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent
 *     This is named $event to match the event name in AngularJS. See:
 *     https://docs.angularjs.org/guide/expression#-event-
 *
 * detail: The event details from the CustomEvent.
 */
interface AngularJSLocals {
  $event: Event;
  detail?: {};
}

/**
 * By default, AngularJS does not interact nicely with custom elements. This
 * method creates a simple wrapper that solves the two key issues with CEs:
 *  1. AngularJS binds to attributes, but custom elements expect properties.
 *  2. AngularJS isn't aware of events fired by custom elements.
 */
export function createNg1Wrapper(
    customElementSelector: string,
    component: Type<{}>,
    config: NgElementConfig,
    ): angular.IComponentOptions {
  const propertyInputs = getComponentInputs(component, config.injector)
                             .map(({propName}) => propName);

  const propertyOutputs = getComponentOutputs(component, config.injector)
                              .map(({propName}) => propName);

  /**
   * Creates a controller for an AngularJS component. This is nested
   * within this method because it relies on some compiler
   * transpilation to rewrite it as a function that is called once per
   * invocation of createNg1Wrapper.
   */
  class Ng1WrapperController {
    private readonly customElement: HTMLElement;
    /** Map to keep track of added eventListeners for cleanup. */
    private readonly eventListeners = new Map<string, EventListener>();

    constructor(
        $element: JQuery,
        private readonly $rootScope: angular.IRootScopeService,
    ) {
      // By default, custom elements are inline elements. This changes
      // it to something more expected.
      $element.css('display', 'inline-block');

      this.customElement =
          ($element as any as HTMLElement[])[0].querySelector<HTMLElement>(customElementSelector)!;
      if (!this.customElement) {
        throw new Error(`No custom element (${customElementSelector}) found.  ¯\_(ツ)_/¯`);
      }
    }

    $onInit() {
      for (const output of propertyOutputs) {
        const eventListener = this.createEventListener(output);
        this.eventListeners.set(output, eventListener);
        this.customElement.addEventListener(output, eventListener);
      }
    }

    $onDestroy() {
      for (const [name, listener] of this.eventListeners.entries()) {
        this.customElement.removeEventListener(name, listener);
      }
    }

    /**
     * Creates an event listener for the custom event.
     *
     * In order to improve ease of use, the custom event detail is extracted and
     * provided as an AngularJS function local. In an AngularJS template, this
     * field can be accessed using "detail" param in the output event handler.
     *
     * @param methodName The name of the method bound with bindToController.
     */
    private createEventListener(methodName: string): EventListener {
      return (e: Event) => {
        const locals: AngularJSLocals = {$event: e};

        if (isCustomEvent(e)) {
          locals.detail = e.detail;
        }

        // Force an AngularJS digest to run so that AngularJS is aware of the
        // browser event and can perform the usually scope life cycle.
        // $apply executes the expression, reports any exceptions to the
        // $exceptionHandler, and fires a digest regardless of the outcome.
        // tslint:disable-next-line:no-any Property set with bindToController.
        this.$rootScope.$apply((this as any)[methodName](locals));
      };
    }
  }
  Ng1WrapperController.$inject= ['$element', '$rootScope'];

  // Add getters and setters to the prototype for each property input.
  // This sets the property on the custom element whenever the AngularJS
  // property is set. This properties are only set on this invocation's
  // instance of the Ng1WrapperController class definition.
  for (const property of propertyInputs) {
    Object.defineProperty(Ng1WrapperController.prototype, property, {
      set(newValue: {}) {
        if (newValue) {
          this.customElement[property] = newValue;
        }
      },
      configurable: true,
      enumerable: true,
    });
  }

  const bindings: {[index: string]: string} = {};
  for (const input of propertyInputs) {
    // Optionality cannot be enforced. Therefore, everything is optional
    // and all error checking should be handled by the Angular component.
    bindings[input] = '<?';
  }

  for (const output of propertyOutputs) {
    // Optionality cannot be enforced. Therefore, everything is optional
    // and all error checking should be handled by the Angular component.
    bindings[output] = '&?';
  }

  const ng1ElementWrapper: angular.IComponentOptions = {
    controller: Ng1WrapperController,
    bindings,
    template: `<${customElementSelector}></${customElementSelector}>`,
  };

  return ng1ElementWrapper;
}

/**
 * Gets a component's set of inputs. Uses the injector to get the component
 * factory where the inputs are defined. Stolen from:
 * https://github.com/angular/angular/blob/95993e1dd523cff96ebc2b42beb1e75dc95ca049/packages/elements/src/utils.ts#L124
 */
function getComponentInputs(component: Type<{}>, injector: Injector):
    Array<{propName: string, templateName: string}> {
  const componentFactoryResolver: ComponentFactoryResolver =
      injector.get(ComponentFactoryResolver);
  const componentFactory =
      componentFactoryResolver.resolveComponentFactory(component);
  return componentFactory.inputs;
}

/**
 * Gets a component's set of outputs. Uses the injector to get the component
 * factory where the outputs are defined.
 */
function getComponentOutputs(component: Type<{}>, injector: Injector):
    Array<{propName: string, templateName: string}> {
  const componentFactoryResolver: ComponentFactoryResolver =
      injector.get(ComponentFactoryResolver);
  const componentFactory =
      componentFactoryResolver.resolveComponentFactory(component);
  return componentFactory.outputs;
}

/** Returns whether an Event is a CustomEvent with a details field. */
function isCustomEvent(e: Event|CustomEvent): e is CustomEvent {
  return (e as CustomEvent).detail !== undefined;
}

