package com.photokeeper;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;

class ArchitectureTest {

  private static final JavaClasses ALL_CLASSES =
      new ClassFileImporter().importPackages("com.photokeeper");

  @Test
  void controllers_should_not_depend_on_each_other() {
    ArchRule rule =
        noClasses()
            .that()
            .resideInAPackage("..controller..")
            .should()
            .dependOnClassesThat()
            .resideInAPackage("..controller..");
    rule.check(ALL_CLASSES);
  }

  @Test
  void services_should_not_depend_on_controllers() {
    ArchRule rule =
        noClasses()
            .that()
            .resideInAPackage("..service..")
            .should()
            .dependOnClassesThat()
            .resideInAPackage("..controller..");
    rule.check(ALL_CLASSES);
  }

  @Test
  void controllers_should_reside_in_controller_package() {
    ArchRule rule =
        classes()
            .that()
            .haveSimpleNameEndingWith("Controller")
            .should()
            .resideInAPackage("..controller..");
    rule.check(ALL_CLASSES);
  }

  @Test
  void services_should_reside_in_service_package() {
    ArchRule rule =
        classes()
            .that()
            .haveSimpleNameEndingWith("Service")
            .should()
            .resideInAPackage("..service..");
    rule.check(ALL_CLASSES);
  }
}
